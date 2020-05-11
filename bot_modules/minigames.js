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
			if(pendingCalls === 0) callback(totalError, res);
		};

		for(let i=0;i<res.rows.length;i++){
			let curPoints = res.rows[i][0] || 0;
			let leaderboardId = res.rows[i][1];
			pgclient.runSql2(UPDATE_LB_ENTRY_SQL, [dbId, leaderboardId, updateFunc(curPoints)], sharedCallback);
			achievements.achievementsOnScoreUpdate(name, leaderboardId, curPoints, updateFunc(curPoints));
		}
	});
}

let updatePointsByPsId = function(psId, name, updateFunc, leaderboards, callback){
	// TODO change the getid to use a single callback
	pgclient.getId(name, true, (res)=>{
		updatePointsByDbId(res.id, name, updateFunc, leaderboards, callback);
	}, (err)=>{callback(err)});
}

class TriviaTrackerGame{
	/// user: the user that gave the command to start the game
	/// room: the room that the game should be started in
	constructor(user, room, config){
		this.room = room;
		this.creator = user;
		this.config = config;
		this.curHist = {active: this.creator};
		this.history = [this.curHist];
		this.maxHistLength = 10;
		this.setupData();
		this.sendStart();
	}

	setupData(){
		this.askPoints = 1;
		this.answerPoints = 1;
		this.leaderboards = ['main', 'highhorsepower'];
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
		updatePointsByPsId(prevUser.id, prevUser.name, (p)=>{return p + this.askPoints}, this.leaderboards, ifError);
		updatePointsByPsId(nextUser.id, nextUser.name, (p)=>{return p + this.answerPoints}, this.leaderboards, ifError);
	}

	makeUndoFunc(id, name, points, leaderboards){
		return ()=>{
			updatePointsByPsId(id, name, (p)=>{return p - points}, leaderboards);
		};
	}

	/// Handles bpopen, including the interactions between different types.
	/// type: the kind of bpopen (eg 'user', 'auth', 'leave')
	doBpOpen(type){

	}

	/// Returns either a false value if the yes can proceed, or a string failure reason.
	cantYes(user1, rank1, id2){
		// Is user1 either the active player or an auth? have they asked a question? is bp locked or open?
		// Is user2 in the room? muted/locked? ttmuted? Different from the active player?
		let user2 = this.room.getUserData(id2);
		let hasRank = AuthManager.rankgeq(rank1, '+');

		// This message should take priority
		if(!hasRank && this.curHist.active.id !== user1.id) return "You are not the active player.";

		// Failure conditions that do not depend on whether user1 is auth
		if(!user2) return "That player is not in the room.";
		if(this.curHist.active.id === id2) return "It is already " + this.curHist.active.name + "'s turn to ask a question.";
		if(user2.trueRank === '‽' || user2.trueRank === '!') return user.name + " is muted or locked.";

		// At this point, if the user1 is auth they can ~yes
		if(AuthManager.rankgeq(rank1, '+')) return;

		// From here on, user1 is not auth
		if(this.curHist.active.id !== user1.id) return "You are not the active player.";
		if(this.bpOpen) return "You cannot use ~yes while bp is open.";
		if(this.bpLocked) return "You cannot use ~yes while bp is locked.";
		if(!this.curHist.hasAsked) return "You must ask a question before you can use ~yes.";
	}

	cantBp(user1, rank1, id2){
		if(!AuthManager.rankgeq(rank1, '+')) return "Your rank is not high enough to use that command.";

		let user2 = this.room.getUserData(id2);

		if(!user2) return "That user is not in the room.";
		if(this.curHist.active.id === id2) return "That user already has BP.";
	}

	cantNo(user, rank){
		if(!AuthManager.rankgeq(rank, '+') && user.id !== this.curHist.active.id) return "Your rank is not high enough to use that command.";
		
		if(this.lastNo && Date.now() - this.lastNo < 5000) return "There is a cooldown between uses of ~no, try again in a few seconds.";
	}

	/// Check if a user can open BP. Either they are auth or they have bp.
	cantOpenBp(user, rank){
		let hasRank = AuthManager.rankgeq(rank, '+');

		if(!hasRank && !this.curHist.active.id !== user.id) return "You are not the active player.";

		if(this.bpOpen === 'auth') return "BP is already open.";
	}

	cantClaimBp(user){
		// TODO implement blaclist check
		if(user.id === this.curHist.active.id) return "You are already the active player.";
	}
	
	doYes(user1, user2, undoAsker){
		// The current asker is the answerer in the most recent history
		if(undoAsker && this.curHist.undoAnswerer){
			this.curHist.undoAnswerer();
			this.curHist.undoAnswerer = null;
		}
		this.givePoints(this.curHist.active, user2);
		let historyToAdd = makeHistory(user1, user2);
		this.changeBp(user1, user2, historyToAdd);
		//TODO implement blacklist check
		this.room.send("**It is now " + user2.name + "'s turn to ask a question.**");
	}

	doNo(user, number){
		game.lastNo = Date.now();
		let i;
		for(i=0;i<number && this.history.length>0;i++){
			let curHist = this.history.pop();
			if(curHist.undoAsker) curHist.undoAsker();
			if(curHist.undoAnswerer) curHist.undoAnswerer();
		}
		let response = "**Undid " + i + " action(s)";
		clearTimers(game);
		this.bpOpen = null;
		this.bpLocked = null;
		if(this.history.length === 0){
			// Make a new history, with just the person who used ~no, and open bp
			return;
		}
		this.curHist = this.history[this.history.length-1];
		let newActive = this.room.getUserData(this.curHist.active.id);
		if(!newActive){
			room.send("Undid " + i + " action(s). Since " + curHist.active.name + " is not in the room, BP is now open.");
		}else if(newActive.trueRank === '!' || newActive.trueRank === '‽'){
			room.send("Undid " + i + " action(s). Since " + newActive.name + " is muted or locked, BP is now open.");
		}else{

		}
	}


	doBp(user1, user2){
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

	}

	setTimer(id, time, callback){
		if(this.timers[id]) clearTimeout(this.timers[id]);
		this.timers[id] = setTimeout(callback, time);
	}

	end(){
		this.clearTimers();
		this.room.send("The game of Trivia Tracker has ended.");
	}
}
exports.TriviaTrackerGame = TriviaTrackerGame;

let refreshDependencies = function(){
	pgclient = require("./pgclient");
	achievements = require("./achievements");
}
exports.refreshDependencies = refreshDependencies;
