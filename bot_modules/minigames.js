let pgclient = require("./pgclient");
let achievements = require("./achievements");

const UPDATE_LB_ENTRY_SQL = "UPDATE tt_points SET points = $3 WHERE id = $1 AND leaderboard = $2;";

let updatePointsByDbId = function(dbId, name, updateFunc, leaderboards, callback){
	pgclient.getPoints(dbId, leaderboards, (err, res)=>{
		if(err){
			callback(err);
			return;
		}
		let pendingCalls = res.rows.length;
		let totalError = null;

		let sharedCallback = (err, res2)=>{
			totalError = totalError || err;
			pendingCalls--;
			if(err) error(err);
			if(pendingCalls === 0) callback(totalError, res);
		};

		for(let i=0;i<res.rows.length;i++){
			let curPoints = res.rows[i].points || 0;
			let leaderboardId = res.rows[i].leaderboard;
			pgclient.runSql(UPDATE_LB_ENTRY_SQL, [dbId, leaderboardId, updateFunc(curPoints)], sharedCallback);
			achievements.achievementsOnScoreUpdate(name, leaderboardId, curPoints, updateFunc(curPoints));
		}
	});
}

let updatePointsByPsId = function(psId, name, updateFunc, leaderboards, callback){
	pgclient.getUser(name, true, (err, res)=>{
		if(err){
			callback(err);
			return;
		}

		pgclient.updatePointsByDbId(res.id, name, updateFunc, leaderboards, callback);
	});
}

class TriviaTrackerGame{
	/// user: the user that gave the command to start the game
	/// room: the room that the game should be started in
	/// config: config settings for the tt module
	constructor(user, room, config, blacklistManager){
		this.room = room;
		this.host = user;
		this.config = config;
		this.curHist = {active: this.host};
		this.history = [this.curHist];
		this.maxHistLength = 10;
		this.blacklistManager = blacklistManager;
		this.timers = {};
		this.chatCommands = {};
		this.scores = {};
		this.setupData();
		this.sendStart();
	}

	setupData(){
		this.askPoints = 1;
		this.answerPoints = 1;
		this.leaderboards = ['main', 'highhorsepower'];
	}

	getHost(){
		return this.host;
	}

	setHost(newHost){
		this.host = newHost;
	}

	sendStart(){
		this.room.send("**A new game of Trivia Tracker has started.**");
	}

	end(){
		this.room.send("The game of Trivia Tracker has ended.");
	}


	/// prevUser: the user that asked the question
	/// nextUser: the user who got the question correct:
	givePoints(prevUser, nextUser){
		if(this.askPoints){
			pgclient.updatePointsByPsId(prevUser.id, prevUser.name, (p)=>{return p + this.askPoints}, this.leaderboards, logIfError);
			if(this.scores[prevUser.id]){
				this.scores[prevUser.id].score = this.scores[prevUser.id].score + this.askPoints;
			}else{
				this.scores[prevUser.id] = {score: this.askPoints, user: prevUser};
			}
		}
		if(this.answerPoints){
			pgclient.updatePointsByPsId(nextUser.id, nextUser.name, (p)=>{return p + this.answerPoints}, this.leaderboards, logIfError);
			if(this.scores[nextUser.id]){
				this.scores[nextUser.id].score = this.scores[nextUser.id].score + this.answerPoints;
			}else{
				this.scores[nextUser.id] = {score: this.answerPoints, user:nextUser};
			}
		}
	}

	makeUndoFunc(id, name, points, leaderboards){
		if(!points) return ()=>{};
		return ()=>{
			pgclient.updatePointsByPsId(id, name, (p)=>{return p - points}, leaderboards, logIfError);
			if(this.scores[id]){
				this.scores[id].score = Math.max(0,this.scores[id].score - points);
			}
		};
	}

	/// Check if a user can open BP. Either they are auth or they have bp.
	cantOpenBp(user, rank, type){
		let isCurUser = this.curHist.active.id !== user.id;
		let hasRank = AuthManager.rankgeq(rank, '+') || user.id === this.host.id;

		if(!hasRank && !isCurUser) return "You are not the active player.";

		if(this.bpOpen === 'auth') return "BP is already open.";

		if(this.bpLock) return "BP cannot be opened while it is locked.";

		if(this.bpOpen && !hasRank) return "BP is already open.";

		if(type !== 'user' && !hasRank) return "You are not able to open BP in that way.";
	}

	/// Handles bpopen, including the interactions between different types.
	/// type: the kind of bpopen (eg 'user', 'auth', 'leave')
	doOpenBp(type, shouldSendMessage){
		// don't open bp if it is locked
		if(this.bpLock) return;
		// auth > timer > leave > user
		// timer, leave, and user shouldn't message if bp is already open at all
		let types = ['user', 'leave', 'timer', 'auth'];
		let curIndex = types.indexOf(this.bpOpen);
		let newIndex = types.indexOf(type);
		if(curIndex === 3){
			return;
		}else if(newIndex === 3){
			this.bpOpen = 'auth';
		}else if(newIndex > curIndex && curIndex > -1){
			this.bpOpen = type;
			return;
		}else if(newIndex > curIndex){
			this.bpOpen = type;
		}else{
			return;
		}
		
		if(shouldSendMessage) this.room.send("**BP is now open (say 'me' or 'bp' to claim it).**");
	}

	cantCloseBp(user, rank){
		let hasRank = AuthManager.rankgeq(rank, '+') || user.id === this.host.id;
		
		if(!this.bpOpen) return "BP is already closed.";

		if(hasRank) return;

		if(this.bpOpen !== 'user' || this.curHist.active.id !== user.id) return "Your rank is not high enough to close BP.";
	}

	doCloseBp(shouldClearTimers, shouldSendMessage){
		this.bpOpen = null;
		if(shouldClearTimers) this.clearTimers();

		if(shouldSendMessage) this.room.send(shouldClearTimers ? "BP is now closed. Timers have been cleared." : "BP is now closed.");
	}

	cantLockBp(user, rank){
		let hasRank = AuthManager.rankgeq(rank, '+') || user.id === this.host.id;

		if(!hasRank) return "Your rank is not high enough to lock BP.";

		if(this.bpLock) return "BP is already locked.";

		// For now, allow bp to be locked while it is open
		// if(this.bpOpen) return "BP cannot be locked while it is open.";
	}

	doBpLock(shouldSendMessage){
		this.clearTimers();
		this.bpLock = true;
		this.bpOpen = null;

		if(shouldSendMessage) this.room.send("**BP is now locked; no one can ask questions.**");
	}

	cantUnlockBp(user, rank){
		let hasRank = AuthManager.rankgeq(rank, '+') || user.id === this.host.id;

		if(!hasRank) return "Your rank is not high enough to unlock BP.";

		if(!this.bpLock) return "BP is already unlocked";
	}

	doBpUnlock(shouldSendMessage){
		this.clearTimers();
		this.bpOpen = null;
		this.bpLock = null;
		let curUser = this.room.getUserData(this.curHist.active.id);
		if(!curUser){
			this.bpOpen = 'auth';
			if(shouldSendMessage) this.room.send("**BP is now unlocked. Since " + this.curHist.active.name + " is not in the room, BP is now open.**");
		}else if(curUser.trueRank === '‽' || curUser.trueRank === '!'){
			this.bpOpen = 'auth';
			if(shouldSendMessage) this.room.send("**BP is now unlocked. Since " + this.curHist.active.name + " is muted or locked, BP is now open.**");
		}else if(shouldSendMessage){
			this.room.send("BP is now unlocked. It is " + this.curHist.active.name + "'s turn to ask a question.");
		}
	}

	cantYes(user1, rank1, id2){
		// Is user1 either the active player or an auth? have they asked a question? is bp locked or open?
		// Is user2 in the room? muted/locked? ttmuted? Different from the active player?
		let user2 = this.room.getUserData(id2);
		let hasRank = AuthManager.rankgeq(rank1, '+') || user1.id === this.host.id;

		// This message should take priority
		if(!hasRank && this.curHist.active.id !== user1.id) return "You are not the active player.";

		// Failure conditions that do not depend on whether user1 is auth
		if(!user2) return "That player is not in the room.";
		if(this.curHist.active.id === id2) return "It is already " + this.curHist.active.name + "'s turn to ask a question.";
		if(user2.trueRank === '‽' || user2.trueRank === '!') return user2.name + " is muted or locked.";

		// At this point, if the user1 is auth they can ~yes
		if(hasRank) return;

		// From here on, user1 is not auth
		if(this.bpOpen) return "You cannot use ~yes while BP is open.";
		if(this.bpLock) return "You cannot use ~yes while BP is locked.";
		if(!this.curHist.hasAsked) return "You must ask a question before you can use ~yes.";
	}

	doYes(user1, user2, undoAsker){
		// The current asker is the answerer in the most recent history
		if(undoAsker && this.curHist.undoAnswerer){
			this.curHist.undoAnswerer();
			this.curHist.undoAnswerer = null;
		}
		this.givePoints(this.curHist.active, user2);
		let historyToAdd = this.makeHistory(user1, user2);
		this.changeBp(user1, user2, historyToAdd);

		let isBlacklisted = this.blacklistManager.getEntry(user2.id);
		if(isBlacklisted) this.doOpenBp('auth', false);

		this.sendYes(user1, user2, undoAsker, isBlacklisted);
	}

	sendYes(user1, user2, undoAsker, isBlacklisted){
		if(isBlacklisted){
			this.room.send("**" + user2.name + " is on the blacklist, so BP is now open.**");
		}else{
			this.room.send("**It is now " + user2.name + "'s turn to ask a question.**");
		}
	}

	cantNo(user, rank, number){
		if(!AuthManager.rankgeq(rank, '+') && user.id !== this.curHist.active.id && user.id !== this.host.id) return "Your rank is not high enough to use that command.";
		
		if(this.lastNo && Date.now() - this.lastNo < 5000) return "There is a cooldown between uses of ~no, try again in a few seconds.";

		if(number > this.maxHistLength) return "The number you gave is larger than the max history length of " + this.maxHistLength + ".";
	}

	doNo(user, number){
		this.lastNo = Date.now();
		let i;
		for(i=0;i<number && this.history.length>0;i++){
			let curHist = this.history.pop();
			if(curHist.undoAsker) curHist.undoAsker();
			if(curHist.undoAnswerer) curHist.undoAnswerer();
		}
		this.clearTimers();
		this.bpOpen = null;
		this.bpLock = null;
		if(this.history.length === 0){
			// Make a new history, with just the person who used ~no, and open bp
			this.curHist = {active: user};
			this.history.push(this.curHist);
			this.room.send("Undid " + i + " action(s). Since the end of the history was reached, BP is now open.");
			this.doOpenBp('auth', false);
			return;
		}
		this.curHist = this.history[this.history.length-1];
		let newActive = this.room.getUserData(this.curHist.active.id);
		if(!newActive){
			this.room.send("Undid " + i + " action(s). Since " + this.curHist.active.name + " is not in the room, BP is now open.");
			this.doOpenBp('auth', false);
		}else if(newActive.trueRank === '!' || newActive.trueRank === '‽'){
			this.room.send("Undid " + i + " action(s). Since " + newActive.name + " is muted or locked, BP is now open.");
			this.doOpenBp('auth', false);
		}else{
			this.room.send("Undid " + i + " action(s). It is now " + newActive.name + "'s turn to ask a question.");
			this.setRemindTimer(this.config.remindTime*1000);
		}
	}

	cantBp(user1, rank1, id2){
		if(!AuthManager.rankgeq(rank1, '+') && user1.id !== this.host.id) return "Your rank is not high enough to use that command.";

		let user2 = this.room.getUserData(id2);

		if(!user2) return "That user is not in the room.";
		if(this.curHist.active.id === id2) return "That user already has BP.";
	}

	doBp(user1, id2){
		let user2 = this.room.getUserData(id2);
		let historyToAdd = {active: user2};
		this.changeBp(user1, user2, historyToAdd);
		this.room.send("**It is now " + user2.name + "'s turn to ask a question.**");
	}

	/// At this point it is assumed that the baton will be passed.
	changeBp(user1, user2, historyToAdd, bypassBl){
		// Append the new hist
		// Update the current hist
		// If user2 is on the blacklist and !bypassBl, open bp
		// Give a message saying who has bp, and mention if they are on the blacklist
		// Clear timers
		this.history.push(historyToAdd);
		this.curHist = historyToAdd;
		if(this.history.length > this.maxHistLength) this.history.shift();
		this.clearTimers();
		this.setRemindTimer(this.config.remindTime*1000);
	}

	makeHistory(user1, user2){
		return {
			active:user2,
			undoAsker: this.makeUndoFunc(this.curHist.active.id, this.curHist.active.name, this.askPoints, this.leaderboards),
			undoAnswerer: this.makeUndoFunc(user2.id, user2.name, this.answerPoints, this.leaderboards)
		};
	}

	/// Clears all timers (eg question asking, leaving)
	clearTimers(){
		for(let name in this.timers){
			if(this.timers[name]){
				clearTimeout(this.timers[name]);
				delete this.timers[name];
			}
		}
	}

	setRemindTimer(duration){
		this.setTimer('remind', duration, ()=>{this.doReminder();});
	}

	setOpenTimer(duration){
		this.setTimer('open', duration, ()=>{this.doOpen();});
	}

	setLeaveTimer(duration){
		this.setTimer('leave', duration, ()=>{this.doLeave();});
	}

	setTimer(id, time, callback){
		this.clearTimer(id);
		this.timers[id] = setTimeout(callback, time);
	}

	clearTimer(id){
		if(this.timers[id]){
			clearTimeout(this.timers[id]);
			delete this.timers[id];
		}
	}

	checkVeto(message){
		return /\*\*([^\s].*)?veto(.*[^\s])?\*\*/i.test(message) || /^\/announce .*veto.*/i.test(message);
	}

	checkBold(message){
		return /\*\*(([^\s])|([^\s].*[^\s]))\*\*/g.test(message);
	}

	doVetoResponse(vetoMessage){
		let messageId = toId(vetoMessage);

		if(/boldfail/i.test(messageId)){
			this.room.send("!rfaq bold");
		}else if(/vdoc/.test(messageId)){
			this.room.send("!rfaq vdoc");
		}
	}

	doReminder(){
		this.clearTimer('remind');
		if(this.curHist.active){
			let rank = AuthManager.getRank(this.curHist.active, this.room);
			let hasManageRank = AuthManager.rankgeq(rank, this.config.manageBpRank);
			if(!this.bpOpen && !this.bpLocked){ // don't remind people to ask questions if BP is locked, since they can't ask.
				if(hasManageRank){
					this.curHist.active.send("You have " + (this.config.openTime) + " seconds to ask a question. If you are holding on to BP for auth purposes, use ~bplock to prevent it from opening.");
				}else{
					this.curHist.active.send("You have " + (this.config.openTime) + " seconds to ask a question.");
				}

			}
			this.setOpenTimer(this.config.openTime*1000)
		}
	}

	doOpen(){
		this.clearTimer('open');
		if(!this.bpOpen && !this.bpLocked){
			this.doOpenBp('timer', true);
		}else if( (this.bpOpen == 'leave' || this.bpOpen == 'user') && !this.bpLocked ){
			this.doOpenBp('timer', false);
		}
	}

	doLeave(){
		this.clearTimer('leave');
		if(!this.bpOpen && !this.bpLock){
			this.doOpenBp('leave', true);
		}
	}

	cantClaimBp(user){
		if(this.blacklistManager.getEntry(user.id)) return "You are on the blacklist and cannot claim BP.";

		if(user.id === this.curHist.active.id) return "You are already the active player.";
	}

	onVeto(vetoee, vetoer, message){
		if(this.curHist.hasAsked){
			this.curHist.hasAsked = false;
			this.clearTimers();
			this.setRemindTimer(this.config.remindTime*1000/2);
		}

		if(vetoee.id !== vetoer.id){
			this.doVetoResponse(message);
		}
	}

	onFirstBold(user, message){
		this.clearTimers();
		this.curHist.hasAsked = true;
		if(message.length > 10){
			this.curHist.question = message;
		}
	}

	onRoomMessage(user, rank, message){
		if(this.bpOpen){
			let text = toId(message);
			if(text === 'bp' || text === 'me' || text === 'bpme'){
				if(this.cantClaimBp(user)){
					// Could potentially PM the user here, but it is probably unnecessary
				}else{
					this.doBp(this.curHist.active, user.id);
					this.bpOpen = false;
				}
			}
		}else if((AuthManager.rankgeq(rank, this.config.manageBpRank) || user.id === this.curHist.active.id) && this.checkVeto(message) && user.id !== mainConfig.userId){
			this.onVeto(this.curHist.active, user, message);
		}else if(user.id === this.curHist.active.id && this.checkBold(message) && !this.curHist.hasAsked){
			this.onFirstBold(user, message);
		}
	}

	onPunishment(user, punishment){
		// If the user isn't the active player, we don't care
		if(!user || user.id !== this.curHist.active.id) return;

		this.doOpenBp('auth', !this.bpOpen);
	}

	onLeave(user){
		if(!this.bpOpen && !this.bpLock && user.id === this.curHist.active.id){
			this.setLeaveTimer(this.config.leaveGraceTime*1000);
		}
	}

	end(){
		this.clearTimers();
		this.room.send("The game of Trivia Tracker has ended.");
	}
}
exports.TriviaTrackerGame = TriviaTrackerGame;

class Blitz extends TriviaTrackerGame{
	
	constructor(user, room, config, blacklistManager){
		super(user, room, config, blacklistManager);
		this.remindTime = 60;
		this.chatCommands['finals'] = (user, rank)=>{this.doFinals(user, rank)};
		this.chatCommands['hyperfinals'] = (user, rank)=>{this.doHyperFinals(user, rank)};
	}

	setupData(){
		this.answerPoints = 2;
		this.leaderboards = ['main', 'highhorsepower'];
	}

	doHyperFinals(user, rank){
		if(user.id !== this.host.id) return;
		this.remindTime = 30;
		this.doFinals(user, rank);
	}

	doFinals(user, rank){
		if(user.id !== this.host.id) return;

		this.leaderboards = ['blitzmonthly'];
		this.scores = {};
		this.clearTimers();
		this.room.send("Congratulations to our blitz finalists! Get ready for the final round!");
	}

	changeBp(user1, user2, historyToAdd, bypassBl){
		this.history.push(historyToAdd);
		this.curHist = historyToAdd;
		if(this.history.length > this.maxHistLength) this.history.shift();
		this.clearTimers();
		if(user2.id !== this.host.id){
			this.setRemindTimer();
		}
	}

	setRemindTimer(duration){
		this.room.send("The timer has been set for " + this.remindTime + " seconds.");
		this.setTimer('remind', this.remindTime*1000, ()=>{this.doReminder();});
	}

	setOpenTimer(duration){
	}

	setLeaveTimer(duration){
	}

	onVeto(vetoee, vetoer, message){
		if(this.curHist.hasAsked){
			this.curHist.hasAsked = false;
			this.clearTimers();
			this.setRemindTimer(this.config.remindTime*1000/2);
		}

		if(vetoee.id !== vetoer.id){
			this.doVetoResponse(message);
		}
	}

	onFirstBold(user, message){
		this.clearTimers();
		this.setRemindTimer();
		this.curHist.hasAsked = true;
		if(message.length > 10){
			this.curHist.question = message;
		}
	}

	doReminder(){
		this.clearTimer('remind');
		this.room.send("Time's up!");
	}

	sendStart(){
		this.room.send("A new game of Blitz is starting! Wait for the host's tossup question.");
	}

	end(){
		this.clearTimers();
		this.room.send("The game of Blitz has ended.");
	}
}
exports.Blitz = Blitz;

class TriviaTrackerSingleAsker extends TriviaTrackerGame{
	/// user: the user that gave the command to start the game
	/// room: the room that the game should be started in
	/// config: config settings for the tt module
	constructor(user, room, config){
		super(user, room, config);
	}

	setupData(){
		this.answerPoints = 1;
		this.leaderboards = [];
	}

	sendStart(){
		this.room.send("**A new game of Trivia Tracker (SA) has started.**");
	}

	sendEnd(){
		this.room.send("The game of Trivia Tracker (SA) has ended.");
	}

	/// Check if a user can open BP. Either they are auth or they have bp.
	cantOpenBp(user, rank, type){
		return "BP cannot be opened in this game type.";
	}

	/// Handles bpopen, including the interactions between different types.
	/// type: the kind of bpopen (eg 'user', 'auth', 'leave')
	doOpenBp(type, shouldSendMessage){}

	cantCloseBp(user, rank){
		return "BP cannot be opened in this game type.";
	}

	doCloseBp(shouldClearTimers, shouldSendMessage){}

	cantLockBp(user, rank){
		return "BP cannot be locked in this game type.";
	}

	doBpLock(shouldSendMessage){}

	cantUnlockBp(user, rank){
		return "BP cannot be locked in this game type.";
	}

	doBpUnlock(shouldSendMessage){}

	cantYes(user1, rank1, id2){
		// Is user1 either the active player or an auth? have they asked a question? is bp locked or open?
		// Is user2 in the room? muted/locked? ttmuted? Different from the active player?
		let user2 = this.room.getUserData(id2);
		let hasRank = AuthManager.rankgeq(rank1, '+') || user1.id === this.host.id;

		// This message should take priority
		if(!hasRank && this.curHist.active.id !== user1.id) return "You are not the question asker.";

		// Failure conditions that do not depend on whether user1 is auth
		if(!user2) return "That player is not in the room.";
		if(this.host.id === id2) return this.host.name + " is the question asker.";
		if(user2.trueRank === '‽' || user2.trueRank === '!') return user2.name + " is muted or locked.";

		// At this point, if the user1 is auth they can ~yes
		if(hasRank) return;
	}

	doYes(user1, user2, undoAsker){
		// The current asker is the answerer in the most recent history
		if(undoAsker && this.curHist.undoAnswerer){
			this.curHist.undoAnswerer();
			this.curHist.undoAnswerer = null;
		}
		this.givePoints(this.curHist.active, user2);
		let historyToAdd = this.makeHistory(user1, user2);
		this.changeBp(user1, user2, historyToAdd);
		// No blacklist here
		this.sendYes(user1, user2, undoAsker);
	}

	sendYes(user1, user2, undoAsker){
		this.room.send(user2.name + " answered correctly. They now have " + this.scores[user2.id].score + " point(s).");
	}

	cantNo(user, rank, number){
		if(!AuthManager.rankgeq(rank, '+') && user.id !== this.curHist.active.id && user.id !== this.host.id) return "Your rank is not high enough to use that command.";
		
		if(this.lastNo && Date.now() - this.lastNo < 5000) return "There is a cooldown between uses of ~no, try again in a few seconds.";

		if(number > this.maxHistLength) return "The number you gave is larger than the max history length of " + this.maxHistLength + ".";
	}

	doNo(user, number){
		this.lastNo = Date.now();
		let i;
		for(i=0;i<number && this.history.length>0;i++){
			let curHist = this.history.pop();
			if(curHist.undoAsker) curHist.undoAsker();
			if(curHist.undoAnswerer) curHist.undoAnswerer();
		}

		if(this.history.length === 0){
			// Make a new history, with just the person who used ~no, and open bp
			this.curHist = {active: user};
			this.history.push(curHist);
			return;
		}
		this.curHist = this.history[this.history.length-1];
		this.room.send("Undid " + i + "action(s).");
	}

	cantBp(user1, rank1, id2){
		if(!AuthManager.rankgeq(rank1, '+') && user.id !== this.host.id) return "Your rank is not high enough to use that command.";

		let user2 = this.room.getUserData(id2);

		if(!user2) return "That user is not in the room.";
		if(this.curHist.active.id === id2) return "That user is already the asker.";
	}

	doBp(user1, id2){
		let user2 = this.room.getUserData(id2);
		let historyToAdd = {active: user1, answerer: user2};
		this.changeBp(user1, user2, historyToAdd);
		this.room.send(user2.name + " is now the question asker.**");
	}

	/// At this point it is assumed that the baton will be passed.
	changeBp(user1, user2, historyToAdd, bypassBl){
		// Append the new hist
		// Update the current hist
		// If user2 is on the blacklist and !bypassBl, open bp
		// Give a message saying who has bp, and mention if they are on the blacklist
		this.history.push(historyToAdd);
		this.curHist = historyToAdd;
		if(this.history.length > this.maxHistLength) this.history.shift();
	}

	makeHistory(user1, user2){
		return {
			active: user1,
			undoAnswerer: this.makeUndoFunc(user2.id, user2.name, this.answerPoints, this.leaderboards),
			answerer: user2
		};
	}


	/// Clears all timers (eg question asking, leaving)
	clearTimers(){
		for(let name in this.timers){
			if(this.timers[name]){
				clearTimeout(this.timers[name]);
				delete this.timers[name];
			}
		}
	}

	setRemindTimer(duration){

	}

	setOpenTimer(duration){
		this.setTimer('open', duration, ()=>{this.doOpen();});
	}

	setLeaveTimer(duration){
		this.setTimer('leave', duration, ()=>{this.doLeave();});
	}

	setTimer(id, time, callback){
		if(this.timers[id]) clearTimeout(this.timers[id]);
		this.timers[id] = setTimeout(callback, time);
	}

	clearTimer(id){
		if(this.timers[id]){
			clearTimeout(this.timers[id]);
			delete this.timers[id];
		}
	}

	checkVeto(message){
		return /\*\*([^\s].*)?veto(.*[^\s])?\*\*/i.test(message) || /^\/announce .*veto.*/i.test(message);
	}

	checkBold(message){
		return /\*\*(([^\s])|([^\s].*[^\s]))\*\*/g.test(message);
	}

	doVetoResponse(vetoMessage){
		let messageId = toId(vetoMessage);

		if(/boldfail/i.test(messageId)){
			this.room.send("!rfaq bold");
		}else if(/vdoc/.test(messageId)){
			this.room.send("!rfaq vdoc");
		}
	}

	doReminder(){}

	doOpen(){
		this.clearTimer('open');
		if(!this.bpOpen && !this.bpLocked){
			this.doOpenBp('timer', true);
		}else if( (this.bpOpen == 'leave' || this.bpOpen == 'user') && !this.bpLocked ){
			this.doOpenBp('timer', false);
		}
	}

	doLeave(){
		this.clearTimer('leave');
		if(!this.bpOpen && !this.bpLock){
			this.doOpenBp('leave', true);
		}
	}

	cantClaimBp(user){
		return "BP cannot be opened in this mode.";
	}
	
	onRoomMessage(user, rank, message){
		if(user.id === this.curHist.active.id && this.checkBold(message)){
			this.clearTimers();
			this.curHist.hasAsked = true;
			if(message.length > 10){
				this.curHist.question = message;
			}
		}
	}

	onPunishment(user, punishment){
	}

	onLeave(user){
	}

	end(){
		this.clearTimers();
		this.sendEnd();
	}
}

class PictureTrivia extends TriviaTrackerSingleAsker{

	constructor(user, room, config){
		super(user, room, config);
	}

	setupData(){
		this.answerPoints = 1;
		this.leaderboards = ['picturetrivia'];
		this.scores = {};
	}

	sendStart(){
		this.room.send("A new game of Picture Trivia has started.");
	}

	sendEnd(){
		this.room.send("The game of Picture Trivia has ended.");
	}

}

let gameTypes = {
	'triviatracker': TriviaTrackerGame,
	'picturetrivia': PictureTrivia,
	'blitz': Blitz
};

exports.gameTypes = gameTypes;


let refreshDependencies = function(){
	pgclient = require("./pgclient");
	achievements = require("./achievements");
}
exports.refreshDependencies = refreshDependencies;
