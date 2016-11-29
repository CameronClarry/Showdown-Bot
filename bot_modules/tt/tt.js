let fs = getRequirement("fs");
let self = {js:{},data:{},requiredBy:[],hooks:{},config:{}};
let chat = null;
let auth = null;
let rooms = null;
const REMIND_TIME = 240000;
const OPEN_TIME = 60000;
info("STARTING TRIVIATRACKER");
exports.onLoad = function(module, loadData){
	self = module;
	self.js.refreshDependencies();
	validateConfigs();
	if(loadData){
	    self.data = {
	        games: {},
	        leaderboard: {},
	        askToReset: ""
	    };
	    loadLeaderboard();
	}
	self.chathooks = {
		chathook: function(m){
			if(m && !m.isInit){
				let text = m.message;
				if(text[0]==="~"){
					let command = text.split(" ")[0].trim().toLowerCase().substr(1);
					let argText = text.substring(command.length+2, text.length);
					let chatArgs = argText === "" ? [] : argText.split(",");
					for(let i = 0;i<chatArgs.length;i++){
						chatArgs[i] = chatArgs[i].trim();
					}
					if(commands[command]&&auth&&auth.js&&chat&&chat.js&&rooms&&rooms.js){
						let rank = auth.js.getEffectiveRoomRank(m, "trivia");
						let commandToRun = commands[command];
						if(typeof commandToRun === "string"){
							commandToRun = commands[commandToRun];
						}
						commandToRun(m, chatArgs, rank);
					}
				}else{
					messageListener(m);
				}
			}
		}
	};

	self.messagehooks = {
		messagehook: function(room, args){
			if(args.length>1){
				let command = args[1].toLowerCase();
				let game = self.data.games[room];
				if(game){
					let lastHist = game.history[game.history.length-1];
					if(command === "l"){
						if(namesMatch(lastHist.active, args[2])){
							if(!game.forcedOpen){
								game.timeout = setTimeout(function(){
									try{
										game.bpOpen = true;
										game.timeout = null;
										if(chat&&chat.js){
											chat.js.say(room, "**" + lastHist.active.trim() + " has left, so BP is now open (say 'me' or 'bp' to claim it).**");
										}
									}catch(e){
										error("Error with player leave callback");
										error(e.message);
									}
								}, 20000);
							}
						}
					}else if(command === "n"){
						if(namesMatch(lastHist.active, args[3])){
							lastHist.active = args[2];
						}
					}else if(command === "j"){
						if((game.timeout || game.bpOpen) && namesMatch(lastHist.active, args[2]) && !game.forcedOpen){
							if(game.timeout){
								clearTimeout(game.timeout);
								game.timeout = null;
							}
							if(game.bpOpen){
								game.bpOpen = false;
								chat.js.say(room, "**" + args[2].trim() + " has rejoined, so BP is no longer open.**");
							}
						}
					}
				}
			}
		}
	};
};
exports.onUnload = function(){

};
exports.refreshDependencies = function(){
	chat = getModuleForDependency("chat", "tt");
	auth = getModuleForDependency("auth", "tt");
	rooms = getModuleForDependency("rooms", "tt");
};
exports.onConnect = function(){

};

let messageListener = function(m){
	let game = self.data.games[m.room];
	if(game){
		let history = game.history;
		let lastHist = history[history.length-1];
		if(game.bpOpen){
			let text = normalizeText(m.message);
			if(text === "bp" || text === "me" || text === "bpme"){
				if(!namesMatch(m.user, mainConfig.user)){
					let displayName = rooms.js.getDisplayName(m.user, m.room);
					if(displayName){
						let result = tryBatonPass(m.room, displayName, {active:displayName,undo: null}, true);
						if(result.result){
							chat.js.say(m.room, "**It is now " + displayName + "'s turn to ask a question.**");
						}
					}
				}
			}
		}
		if(namesMatch(lastHist.active, m.user) && /\*\*(([^\s])|([^\s].*[^\s]))\*\*/g.test(m.message)){
			clearTimers(game);
			info(m.user + " has now asked a question");
			lastHist.hasAsked = true;
		}else{
			let rank = auth.js.getEffectiveRoomRank(m, "trivia");
			if(auth.js.rankgeq(rank, "+") || namesMatch(lastHist.active, m.user)){
				if(/\*\*.*veto.*\*\*/i.test(m.message) || /\/announce .*veto.*/i.test(m.message)){
					lastHist.hasAsked = false;

				}
			}
		}
	}
};

let commands = {

	// newgame, endgame, blacklist
	tt: function(message, args, rank){
		if(args.length>0){
			let command = args[0].toLowerCase();
			if(ttCommands[command]){
				ttCommands[command](message, args, rank);
			}
		}
	},
	// list, check, set, add, remove, reset, lastreset, event
	ttl: "ttleaderboard",
	ttleaderboard: function(message, args, rank){
		if(args.length>0){
			let command = args[0].toLowerCase();
			if(ttleaderboardCommands[command]){
				ttleaderboardCommands[command](message, args, rank);
			}
		}
	},
	yea: "yes",
	yup: "yes",
	sure: "yes",
	yee: "yes",
	yep: "yes",
	yeah: "yes",
	hellyeah: "yes",
	ofcourse: "yes",
	butofcourse: "yes",
	go: "yes",
	yes: function(message, args, rank){
		let room = message.room;
		let success = false;
		if(args.length>1){
			room = normalizeText(args[1]);
		}
		let response = "There is no trivia game in " + room + ".";
		let game = self.data.games[room];
		if(game){
			response = "You must specify a player.";
			if(args.length>0){
				let history = game.history;
				response = "You either are not the active user or do not have a high enough rank to use this command.";
				let userMatchesHistory = namesMatch(history[history.length-1].active, message.user);
				if(userMatchesHistory && !history[history.length-1].hasAsked && !auth.js.rankgeq(rank,"+")){
					response = "You must ask a question in bold before you use ~yes. If your question was veto'd, please ask a new one or discuss it with a staff member.";
					userMatchesHistory = false;
				}else if(auth.js.rankgeq(rank,"+") || userMatchesHistory){
					let nextPlayer = rooms.js.getDisplayName(args[0], room);
					let result = tryBatonPass(room, args[0], {active:nextPlayer, undo:function(){
						leaderboardAddPoints(nextPlayer, -1);
					}}, false);
					success = result.result;
					if(success){
						leaderboardAddPoints(nextPlayer, 1);
						chat.js.say(room, result.response);
					}else{
						response = result.response;
					}
				}
			}
		}
		if(!success){
			chat.js.reply(message, response);
		}
	},
	nah: "no",
	nope: "no",
	no: function(message, args, rank){
		let success = false;
		let room = message.room;
		let number = 1
		if(args.length>1){
			room = normalizeText(args[1]);
		}
		let user = rooms.js.getDisplayName(message.user, room);
		if(args.length>0){
			if(/^\d+$/.test(args[0])){
				number = parseInt(args[0],10);
			}
		}
		let response = "There is no game of trivia in " + room + ".";
		let game = self.data.games[room];
		if(game){
			let history = game.history;
			response = "Your rank is not high enough to use that command.";

			if(auth.js.rankgeq(rank, "+") || (namesMatch(message.user, history[history.length-1].active) && number === 1)){
				if(game.lastNo && Date.now() - game.lastNo < 5000){
					response = "There is a cooldown below uses of ~no, try again in a few seconds.";
				}else{
					success = true;
					game.lastNo = Date.now();
					let i;
					for(i=0;i<number && history.length>0;i++){
						let curHist = history.pop();
						if(typeof curHist.undo === "function"){
							curHist.undo();
						}
					}
					response = "**Undid " + i + " action" + (i === 1 ? "" : "s");
					clearTimers(game);
					if(history.length>0){
						let newActive = history[history.length-1].active;
						if(rooms.js.isInRoom(newActive, room)){
							response += ", it is now " + newActive + "'s turn to ask a question.**";
						}else{
							if(user){
								history.add({active: user, undo: null});
								response += ". Since " + newActive + " is not in the room, it is now " + user + "'s turn to ask a question.**";
							}else{
								response += ". Since " + newActive + " is not in the room, BP is open.**";
								game.bpOpen = true;
								game.forcedOpen = true;
							}
						}
					}else{
						if(user){
							history.add({active: user, undo: null});
							response += ". Since the end of the history was reached, it is now " + message.user + "'s turn to ask a question.**";
						}else{
							". Since the end of the history was reached and the person who used the command is not here for some reason, BP is open.**";
							game.bpOpen = true;
							game.forcedOpen = true;
							if(game.timeout){
								clearTimeout(game.timeout);
								game.timeout = null;
							}
						}
					}
					game.bpOpen = false;
					chat.js.say(room, response);
				}
			}
		}
		if(!success){
			chat.js.reply(message, response);
		}
	},
	bp: function(message, args, rank){
		let room = message.room;
		let success = false;
		if(args.length>1){
			room = normalizeText(args[1]);
		}
		let response = "There is no trivia game in " + room + ".";
		let game = self.data.games[room];
		if(game){
			response = "You must specify a player.";
			if(args.length>0 && args[0]){
				let history = game.history;
				response = "You either are not the active user or do not have a high enough rank to use this command.";
				let userMatchesHistory = namesMatch(history[history.length-1].active, message.user);
				if(auth.js.rankgeq(rank,"+") || userMatchesHistory){
					let nextPlayer = rooms.js.getDisplayName(args[0], room);
					let result = tryBatonPass(room, args[0], {active: nextPlayer, undo: null}, userMatchesHistory && !auth.js.rankgeq(rank,"+"));
					success = result.result;
					if(success){
						chat.js.say(room, result.response);
					}else{
						response = result.response;
					}
				}
			}else{
				let history = game.history;
				let name = history[history.length-1].active;
				chat.js.reply(message, name + " currently has BP.");
				success = true;
			}
		}
		if(!success){
			chat.js.reply(message, response);
		}
	},
	openbp: "bpopen",
	bpopen: function(message, args, rank){
		let success = false;
		let response = "You must specify a room.";
		let room = message.source === "pm" ? args[0] : message.room;
		if(room){
			response = "There is no game in " + room + ".";
			let game = self.data.games[room];
			if(game){
				response = "You either are not the active player or are not ranked high enough to open BP.";
				let lastHist = game.history[game.history.length-1];
				if(namesMatch(lastHist.active, message.user) || auth.js.rankgeq(rank, "+")){
					response = "BP is already open.";
					if(!game.bpOpen){
						success = true;
						game.bpOpen = true;
						game.forcedOpen = true;
						clearTimers(game);
						chat.js.say(room, "**BP is now open (say 'me' or 'bp' to claim it).**");
					}
				}
			}
		}
		if(!success){
			chat.js.reply(message, response);
		}
	},
	closebp: "bpclose",
	bpclose: function(message, args, rank){
		let success = false;
		let response = "You must specify a room.";
		let room = message.source === "pm" ? args[0] : message.room;
		if(room){
			response = "There is no game in " + room + ".";
			let game = self.data.games[room];
			if(game){
				response = "You either are not the active player or are not ranked high enough to open BP.";
				let lastHist = game.history[game.history.length-1];
				if(namesMatch(lastHist.active, message.user) || auth.js.rankgeq(rank, "+")){
					response = "BP is not open.";
					if(game.bpOpen){
						success = true;
						game.bpOpen = false;
						game.forcedOpen = false;
						clearTimers(game);
						chat.js.say(room, "**BP is now closed.**");
					}
				}
			}
		}
		if(!success){
			chat.js.reply(message, response);
		}
	},
	bl: "blacklist",
	blacklist: function(message, args, rank){
		let response = "Your rank is not high enough to use the blacklist command.";
		let leaderboard = self.data.leaderboard;
		if(auth.js.rankgeq(rank,"@")){
			if(args.length<2){
				response = "Not enough arguments were given for the blacklist command.";
			}else{
				let command = normalizeText(args[0])
				let username = normalizeText(args[1]);
				let entry = getBlacklistEntry(username);
				if(command === "add"){
					if(entry && args.length < 3){
						response = "The user " + entry.displayName + " is already on the blacklist.";
					}else{
						let reason = args[2] || "No reason given";
						let duration = args[3];
						if(duration && duration !== "0" && typeof duration == "string" && /^\d+$/.test(duration)){
							duration = parseInt(duration);
							leaderboard.blacklist[username] = {displayName: args[1], reason: reason, duration: duration*60000, time: Date.now()};
							response = "Added " + args[1] + " to the blacklist for " + millisToTime(duration*60000) + ".";
						}else{
							leaderboard.blacklist[username] = {displayName: args[1], reason: reason};
							response = "Added " + args[1] + " to the blacklist.";
						}
					}
				}else if(command === "remove"){
					if(!entry){
						response = "The user " + args[1] + " is not on the blacklist.";
					}else{
						delete leaderboard.blacklist[username];
						response = "Removed " + entry.displayName + " from the blacklist.";
					}
				}else if(command === "check"){
					if(entry){
						response = "The user " + entry.displayName + " is on the blacklist. Reason: " + (entry.reason ? entry.reason : "No reason given") + ".";
						if(entry.duration){
							response += " Time remaining: " + millisToTime(entry.duration - Date.now() + entry.time) + "."
						}
					}else{
						response = "The user " + args[1] + " is not on the blacklist.";
					}
				}else{
					response = "The blacklist command you gave was not recognized.";
				}
			}
			saveLeaderboard();
		}
		chat.js.reply(message, response);
	},
	now: function(message, args, rank){
		chat.js.reply(message, new Date().toUTCString());
	},
	next: function(message, args, rank){
		let timeDiff = (1457024400000-new Date().getTime())%14400000+14400000;
		let response = "The next official is (theoretically) in " + millisToTime(timeDiff) + ".";
		chat.js.reply(message, response);
	},
	alts: function(message, args, rank){
		let user = normalizeText(message.user);
		if(args.length>0){
			user = normalizeText(args[0]);
		}
		let response = "Your rank is not high enough to check other users' alts.";
		let leaderboard = self.data.leaderboard;
		if(leaderboard){
			let entry = leaderboard.alts[getMain(user)];
			if(auth.js.rankgeq(rank, "%") || namesMatch(user, message.user)){
				if(entry&&entry.alts&&entry.alts.length>0){
					response = getMain(user) + "'s alts are: " + entry.alts[0];
					for(let i=1;i<entry.alts.length;i++){
						if(response.length + entry.alts[i].length < 298){
							response += ", " + entry.alts[i];
						}else{
							for(let j=i;j>-1;j--){
								let textToAdd = ", and " + (entry.alts.length-j) + " more.";
								if(response.length+textToAdd.length<300){
									response += textToAdd;
									break;
								}
								response = response.replace(/,\s[a-z\d]+$/,"");
							}
							break;
						}
					}
				}else{
					response = user + " does not have any alts.";
				}
			}
		}
		chat.js.reply(message, response);
	},
	alt: function(message, args, rank){
		let user = normalizeText(message.user);
		let response = "You must specify an alt.";
		if(args.length>0){
			let altuser = normalizeText(args[0]);
			let pendingAlts = self.data.leaderboard.pendingAlts;
			let alts = self.data.leaderboard.alts;
			if(pendingAlts[altuser] && pendingAlts[altuser].indexOf(user)>-1){
				if(!alts[altuser]){
					alts[altuser] = {alts: []};
				}
				if(!alts[user]){
					alts[user] = {alts: []};
				}
				pendingAlts[altuser].splice(pendingAlts[altuser].indexOf(user),1);
				if(pendingAlts[altuser].length === 0){
					delete pendingAlts[altuser];
				}
				mergeAlts(altuser, user);
				response = "Successfully linked accounts.";
			}else{
				if(!pendingAlts[user]){
					pendingAlts[user] = [];
				}
				if(pendingAlts[user].indexOf(altuser) === -1){
					pendingAlts[user].push(altuser);
					saveLeaderboard();
					response = "Now say \"~alt " + user + "\" on that account to link them.";
				}else{
					response = "That is already a pending alt of yours.";
				}
			}
		}
		chat.js.reply(message, response);
	},
	main:function(message, args, rank){
		let response = "You must specify an alt to set as your main account.";
		if(args.length>0){
			response = "Call for help, Jeopard-E seems to be malfunctioning.";
			let alts = self.data.leaderboard.alts;
			let newMain = normalizeText(args[0]);
			let oldMain = getMain(normalizeText(message.user));

			if(newMain === oldMain){
				response = args[0] + " is already your main account.";
			}else{
				let oldMainEntry = alts[oldMain];
				let newMainEntry = alts[newMain];
				if(!oldMainEntry){
					response = "You do not have any alts.";
				}else if(!newMainEntry){
					response = "The user you specified does not have any alts.";
				}else if(!oldMainEntry.alts || oldMainEntry.alts.indexOf(newMain) === -1){
					response = newMain + " is not an alt of yours.";
				}else{
					delete newMainEntry.main;
					newMainEntry.alts = [oldMain];
					while(oldMainEntry.alts.length>0){
						let alt = oldMainEntry.alts.pop();
						let altEntry = alts[alt];
						if(altEntry && alt !== newMain){
							altEntry.main = newMain;
							newMainEntry.alts.push(alt);
						}
					}
					oldMainEntry.alts = null;
					delete oldMainEntry.alts;
					oldMainEntry.main = newMain;
					transferPoints(oldMain, newMain);
					saveLeaderboard();
					response = "Your main username is now " + args[0] + ".";
				}
			}
		}
		chat.js.reply(message, response);
	},
	ttlload: function(message, args, rank){
		if(auth.js.rankgeq(rank,"@")){
			loadLeaderboard();
			chat.js.reply(message, "Loaded leaderboard.");
		}
	},
	ttlsave: function(message, args, rank){
		if(auth.js.rankgeq(rank,"@")){
			saveLeaderboard();
			chat.js.reply(message, "Saved leaderboard.");
		}
	}
};

let ttCommands = {
	newgame: function(message, args, rank){
		let room = message.room;
		if(args.length > 1){
			room = normalizeText(args[1]);
		}
		if(room === ""){
			chat.js.reply(message, "You must specify a room for the game.");
		}else if(!rooms.data.rooms[room]){
			chat.js.reply(message, "I am not in the room '" + room + "'.");
		}else if(self.data.games[room]){
			chat.js.reply(message, "There is already a game of Trivia Tracker in " + room + ".");
		}else if(!auth.js.rankgeq(rank, self.config.startGameRank)){
			chat.js.reply(message, "Your rank is not high enough to start a game of Trivia Tracker");
		}else{
			let user = rooms.js.getDisplayName(message.user, room);
			if(user){
				self.data.games[room] = {room: room, history:[{active:user,undo:null}]};
				chat.js.say(room,"**A new game of Trivia Tracker has started.**");
			}else{
				self.data.games[room] = {room: room, history:[], bpOpen: true, forcedOpen: true};
				chat.js.say(room,"**A new game of Trivia Tracker has started. Since " + message.user + " is not in the room for some reason, BP is now open.**");
			}

		}
	},
	endgame: function(message, args, rank){
		let room = message.room;
		if(args.length > 1){
			room = normalizeText(args[1]);
		}
		if(room === ""){
			chat.js.reply(message, "You must specify a room for the game.");
		}else if(!self.data.games[room]){
			chat.js.reply(message, "There is no game of Trivia Tracker in " + room + " to end.");
		}else if(!auth.js.rankgeq(rank, self.config.endGameRank)){
			chat.js.reply(message, "Your rank is not high enough to end the game of Trivia Tracker.");
		}else{
			delete self.data.games[room];
			chat.js.say(room,"**The game of Trivia Tracker has ended.**");
		}
	}
};

let ttleaderboardCommands = {
	list: function(message, args, rank){
		let response = "Something has probably gone very wrong if you see this text";
		let eventname = false;
		let number = 5;
		if(args.length>1){
			if(!/^-?[\d]+$/.test(args[1])){
				response = "Invalid number format for the number of points.";
			}else{
				number = parseInt(args[1], 10);
			}
		}
		if(args.length>2){
			eventname = args[2];
		}
		response = leaderboardListPoints(number, eventname);
		chat.js.reply(message, response);
	},
	check: function(message, args, rank){
		let response = "Something has probably gone very wrong if you see this text";
		if(args.length === 1){
			response = leaderboardCheckPoints(message.user);
		}else if(args.length === 2){
			response = leaderboardCheckPoints(args[1]);
		}else if(args.length>2){
			response = leaderboardCheckPoints(args[1], args[2]);
		}
		chat.js.reply(message, response);
	},
	//Number of people, your place, your score, points to next place
	summary: function(message, args, rank){
		let leaderboard = self.data.leaderboard.players;
		let userEntry = leaderboard[normalizeText(getMain(message.user))];
		let entries = [];
		for(let name in leaderboard){
			let entry = leaderboard[name];
			if(entry.score && entry.score>0){
				entries.push(entry);
			}
		}
		entries.sort(function(item1, item2){
			return item1.score > item2.score ? -1 : 1;
		});
		let totalUsers = entries.length;
		let topEntry = entries[0];
		let response = "Terrible mistake if you're seeing this.";
		if(totalUsers === 0){
			response = "There is no one on the leaderboard.";
		}else if(userEntry === topEntry){
			if(totalUsers === 1){
				response = "You are the only person on the leaderboard, with a score of " + userEntry.score + ".";
			}else{
				response = "There are " + totalUsers + " players on the leaderboard, and you are in first with a score of " + userEntry.score + ".";
				let secondEntry = entries[1];
				response += " Second place is " + secondEntry.displayName + " with a score of " + secondEntry.score + ".";
			}
		}else if(userEntry){
			entries = entries.filter(function(item){
				return item.score>userEntry.score;
			});
			if(totalUsers === 1){
				response = "The only person on the leaderboard is " + topEntry.displayName + ", with a score of " + topEntry.score + ".";
			}else{
				response = "There are " + totalUsers + " players on the leaderboard, the top being " + topEntry.displayName + " with a score of " + topEntry.score + ".";
				response += " Your rank is " + (entries.length + 1) + ", and you have " + userEntry.score + " point" + (userEntry.score === 1 ? "" : "s") + ".";
			}
		}else{
			if(totalUsers === 1){
				response = "The only person on the leaderboard is " + topEntry.displayName + ", with a score of " + topEntry.score + ".";
			}else{
				response = "There are " + totalUsers + " players on the leaderboard, the top being " + topEntry.displayName + " with a score of " + topEntry.score + ".";
			}
		}
		chat.js.reply(message, response);
	},
	stats: function(message, args, rank){
		let response = "Not yet implemented :<";

		let leaderboard = self.data.leaderboard.players;
		let userEntry = leaderboard[normalizeText(getMain(message.user))];
		let entries = [];
		let totalScore = 0;
		for(let name in leaderboard){
			let entry = leaderboard[name];
			if(entry.score && entry.score>-1){
				entries.push(entry);
				totalScore += entry.score;
			}
		}
		entries.sort(function(item1, item2){
			return item1.score > item2.score ? -1 : 1;
		});
		let numPlayers = entries.length;
		if(numPlayers !== 0){
			let median;
			if(numPlayers%2 === 0){
				median = (entries[numPlayers/2].score+entries[numPlayers/2+1].score)/2;
			}else{
				median = entries[Math.floor(numPlayers/2)].score;
			}
			let mean = totalScore/numPlayers;
			let sd = 0;
			for(let i=0;i<entries.length;i++){
				sd += Math.pow(entries[i].score - mean,2);
			}
			sd = Math.sqrt(sd/numPlayers);
			response = "Total players: " + numPlayers + ", mean score: " + Math.round(mean*100)/100 + ", median: " + median + ", standard deviation: " + Math.round(sd*100)/100;
		}else{
			response = "There is no one on the leaderboard.";
		}

		chat.js.reply(message, response);
	},
	set: function(message, args, rank){
		let response = "Your rank is not high enough to change someone's score.";
		if(auth.js.rankgeq(rank, self.config.editScoreRank)){
			if(args.length>2){
				let user = args[1];
				let points = 0;
				let eventname = false;
				if(args.length>3){
					eventname = args[3];
				}
				if(!/^-?[\d]+$/.test(args[2])){
					response = "Invalid number format for the number of points.";
				}else{
					points = parseInt(args[2], 10);
					response = leaderboardSetPoints(user, points, eventname);
				}
			}else{
				response = "You must specify the user's name, and the number of points to add.";
			}
		}
		chat.js.reply(message, response);
	},
	add: function(message, args, rank){
		let response = "Your rank is not high enough to change someone's score.";
		if(auth.js.rankgeq(rank, self.config.editScoreRank)){
			if(args.length>2){
				let user = args[1];
				let points = 0;
				if(!/^-?[\d]+$/.test(args[2])){
					response = "Invalid number format for the number of points.";
				}else{
					points = parseInt(args[2], 10);
					response = leaderboardAddPoints(user, points);
				}
			}else{
				response = "You must specify the user's name, and the number of points to add.";
			}
		}
		chat.js.reply(message, response);
	},
	remove: function(message, args, rank){
		let response = "You must specify a user.";
		if(args.length>1 && auth.js.rankgeq(rank, "@")){
			let user = null;
			let normalUser = normalizeText(args[1]);
			let leaderboard = self.data.leaderboard;
			if(leaderboard.players[normalUser]){
				user = leaderboard.players[normalUser].displayName;
				delete leaderboard.players[normalUser];
			}
			for(let eventname in leaderboard.events){
				let event = leaderboard.events[eventname];
				if(event.players[normalUser]){
					user = event.players[normalUser].displayName;
					delete event.players[normalUser];
				}
			}
			if(user === null){
				response = args[1] + " was not on any leaderboards.";
			}else{
				response = "Successfully removed " + user + " from all leaderboards.";
			}
			saveLeaderboard();
		}
		chat.js.reply(message, response);
	},
	reset: function(message, args, rank){
		let leaderboard = self.data.leaderboard;
		let response = "Your rank is not high enough to reset the leaderboard.";
		if(auth.js.rankgeq(rank, self.config.resetLeaderboardRank)){
			if(namesMatch(message.user, self.data.askToReset)){
				leaderboard.players = {};
				leaderboard.lastReset = new Date().toUTCString();
				saveLeaderboard();
				response = "The leaderboard has been reset.";
				self.data.askToReset = "";
			}else{
				self.data.askToReset = message.user;
				response = "Are you sure you want to reset the leaderboard? (Enter the reset command again to confirm)";
			}
		}
		chat.js.reply(message, response);
	},
	lastreset: function(message, args, rank){
		chat.js.reply(message, "Last reset: " + self.data.leaderboard.lastReset);
	},
	event: function(message, args, rank){
		if(args.length>1){
			let command = args[1].toLowerCase();
			if(ttleaderboardEventCommands[command]){
				ttleaderboardEventCommands[command](message, args, rank);
			}
		}
	}
};

let ttleaderboardEventCommands = {
	list: function(message, args, rank){
		let count = 0;
		let response = "There are no event leaderboards right now.";
		for(let name in self.data.leaderboard.events){
			if(count === 0){
				response = "These are the current event leaderboards: ";
			}
			if(count>0){
				response += ", ";
			}
			response += self.data.leaderboard.events[name].displayName;
			count++;
		}
		chat.js.reply(message, response);
	},
	add: function(message, args, rank){
		let response = "Your rank is not high enough to add an event leaderboard.";
		if(auth.js.rankgeq(rank, self.config.manageEventRank)){
			response = "You must specify the name for the event ladder.";
			if(args.length>2){
				let displayName = args[2];
				let normalName = normalizeText(displayName);
				if(self.data.leaderboard.events[normalName]){
					response = "There is already a ladder with the name '" + self.data.leaderboard.events[normalName].displayName + "'.";
				}else{
					self.data.leaderboard.events[normalName] = {
						displayName: displayName,
						started: new Date().toUTCString(),
						players: {}
					};
					saveLeaderboard();
					response = "Successfully added the event ladder '" + displayName + "'.";
				}
			}
		}
		chat.js.reply(message, response);
	},
	remove: function(message, args, rank){
		let response = "Your rank is not high enough to remove an event leaderboard.";
		if(auth.js.rankgeq(rank, self.config.manageEventRank)){
			response = "You must specify the name for the event ladder.";
			if(args.length>2){
				let normalName = normalizeText(args[2]);
				let eventLadder = self.data.leaderboard.events[normalName];
				if(!eventLadder){
					response = "There is no ladder with the name '" + args[2] + "'.";
				}else{
					let displayName = eventLadder.displayName;
					delete self.data.leaderboard.events[normalName];
					saveLeaderboard();
					response = "Successfully removed the event ladder '" + displayName + "'.";
				}
			}
		}
		chat.js.reply(message, response);
	},
	started: function(message, args, rank){
		let response = "You must specify the name for the event leaderboard.";
		if(args.length>2){
			let normalName = normalizeText(args[2]);
			let eventLadder = self.data.leaderboard.events[normalName];
			if(!eventLadder){
				response = "There is no ladder with the name '" + args[2] + "'.";
			}else{
				let displayName = eventLadder.displayName;
				response = "The event ladder '" + displayName + "' was started on " + eventLadder.started + ".";
			}
		}
		chat.js.reply(message, response);
	}
};

let tryBatonPass = function(room, nextPlayer, historyToAdd, shouldUndo){
	let game = self.data.games[room];
	let result = false;
	let response = "There is no game of Trivia Tracker in " + room + ".";
	if(game){
		let history = game.history;
		let displayName = rooms.js.getDisplayName(nextPlayer, room);
		if(displayName === null){
			response = "The user " + nextPlayer + " is not in the room " + room + ".";
		}else if(namesMatch(nextPlayer, history[history.length-1].active)){
			response = "It is already " + displayName + "'s turn to ask a question.";
		}else if(getBlacklistEntry(normalizeText(nextPlayer))){
			response = displayName + " is on the blacklist.";
		}else if(displayName !== null){
			let lastHist = history[history.length-1];
			if(shouldUndo){
				if(typeof lastHist.undo === "function"){
					lastHist.undo();
					lastHist.undo = null;
				}
			}
			game.history.add(historyToAdd);
			if(history.length>10){
				history.shift();
			}
			result = true;
			game.bpOpen = false;
			game.forcedOpen = false;
			clearTimers(game);

			game.remindTimer = setTimeout(()=>{
				onRemind(game);
			},REMIND_TIME);

			response = "**It is now " + displayName + "'s turn to ask a question.**";
		}
	}
	return {result: result, response: response};
};

let onRemind = function(game){
	let history = game.history;
	if(history && history.length){
		chat.js.pm(history[history.length-1].active, "You have " + (OPEN_TIME/1000) + " seconds to ask a question.");
		let rank = auth.js.getRoomRank(history[history.length-1].active, "trivia");
		if(!auth.js.rankgeq(rank,"+")){
			game.openTimer = setTimeout(()=>{
				onTimeUp(game);
			},OPEN_TIME);
		}
	}
};

let onTimeUp = function(game){
	if(!game.bpOpen){
		game.bpOpen = true;
		game.forcedOpen = true;
		clearTimers(game);
		chat.js.say(game.room, "**BP is now open (say 'me' or 'bp' to claim it).**");
	}
}

let clearTimers = function(game){
	if(game.timeout){
		clearTimeout(game.timeout);
		game.timeout = null;
	}
	if(game.remindTimer){
		clearTimeout(game.remindTimer);
		game.remindTimer = null;
	}
	if(game.openTimer){
		clearTimeout(game.openTimer);
		game.openTimer = null;
	}
}

let leaderboardCheckPoints = function(username, eventname){
	username = getMain(username);
	let leaderboard = self.data.leaderboard;
	let normalUser = normalizeText(username);
	let response = "The leaderboard you specified could not be found.";
	if(eventname){
		leaderboard = leaderboard.events[normalizeText(eventname)];
	}
	if(leaderboard){
		let entry = leaderboard.players[normalUser];
		if(entry){
			let rank = 1;
			for(let player in leaderboard.players){
				if(leaderboard.players[player].score > entry.score){
					rank++;
				}
			}
			response = entry.displayName + " has a score of " + entry.score + " in " + (eventname ? leaderboard.displayName : "the main leaderboard") + " (a rank of " + rank + ").";
		}else{
			response = username + " does not have a score in " + (eventname ? leaderboard.displayName : "the main leaderboard") + ".";
		}
	}
	return response;
};

let leaderboardListPoints = function(number, eventname){
	let leaderboard = self.data.leaderboard;
	let response = "The leaderboard you specified could not be found.";
	if(eventname){
		leaderboard = leaderboard.events[normalizeText(eventname)];
	}
	if(leaderboard){
		response = number === 1 ? "The top score in " + (eventname ? leaderboard.displayName : "the main leaderboard") + " is: " : "The top " + number + " scores in " + (eventname ? leaderboard.displayName : "the main leaderboard") + " are: ";
		let entries = [];
		for(let player in leaderboard.players){
			if(leaderboard.players[player].score>0){
				entries.push(leaderboard.players[player]);
			}
		}
		entries.sort(function(item1, item2){
			return item1.score > item2.score ? -1 : 1;
		});
		for(let i=0;i<number && i<entries.length;i++){
			if(i>0){
				response += ", ";
			}
			response += "__" + entries[i].displayName + "__: " + entries[i].score;
		}
		response += ".";
	}
	return response;
};

let leaderboardSetPoints = function(username, numPoints, eventname){
	username = getMain(username);
	let leaderboard = self.data.leaderboard;
	let normalUser = normalizeText(username);
	let response = "The leaderboard you specified could not be found.";
	if(eventname){
		leaderboard = leaderboard.events[normalizeText(eventname)];
	}
	if(leaderboard){
		let entry = leaderboard.players[normalUser];
		if(entry){
			entry.score = numPoints;
			response = "Set the score for " + username + " to " + numPoints + " in " + (eventname ? leaderboard.displayName : "the main leaderboard") + ".";
		}else{
			leaderboard.players[normalUser] = {displayName: username, score: numPoints};
			response = "Created a leaderboard entry for " + username + ", and set their score to " + numPoints + " in " + (eventname ? leaderboard.displayName : "the main leaderboard") + ".";
		}
		saveLeaderboard();
	}
	return response;
};

let leaderboardAddPoints = function(username, numPoints){
	username = getMain(username);
	let leaderboard = self.data.leaderboard;
	let normalUser = normalizeText(username);
	let response = "";
	let entry = leaderboard.players[normalUser];
	if(entry){
		response = "Updated the scores for " +entry.displayName + ". Their main leaderboard score changed from " + entry.score;
		entry.score+=numPoints;
		response += " to " + entry.score + ".";
	}else{
		leaderboard.players[normalUser] = {displayName: removeRank(username), score: numPoints};
		response = "Created a leaderboard entry for " + username + ", and set their score to " + numPoints + ".";
	}
	for(let eventname in leaderboard.events){
		let event = leaderboard.events[eventname];
		let entry = event.players[normalUser];
		if(entry){
			entry.score+=numPoints;
		}else{
			event.players[normalUser] = {displayName: username, score: numPoints};
		}
	}
	saveLeaderboard();
	return response;
};

let getEntry = function(user, eventname){
	let leaderboard = self.data.leaderboard;
	if(leaderboard){
		if(!eventname){
			return leaderboard.players[normalizeText(user)];
		}else{
			let event = leaderboard.events[normalizeText(eventname)];
			if(event){
				return event.players[normalizeText(user)]
			}
		}
	}
	return null;
};

let mergeAlts = function(oldName, newName){
	let alts = self.data.leaderboard.alts;
	let oldEntry = alts[oldName];
	let newEntry = alts[newName];
	if(oldEntry.main && newEntry.main){
		if(oldEntry.main !== newEntry.main){
			mergeAlts(oldEntry.main, newEntry.main);
		}
	}else if(oldEntry.main){
		if(oldEntry.main !== newName){
			mergeAlts(oldEntry.main, newName);
		}
	}else if(newEntry.main){
		if(newEntry.main !== oldName){
			mergeAlts(oldName, newEntry.main);
		}
	}else if(oldName !== newName){
		if(!oldEntry.alts){
			oldEntry.alts = [];
		}
		let oldAlts = oldEntry.alts;
		let newAlts = newEntry.alts;
		transferPoints(newName, oldName);
		oldAlts.push(newName);
		if(newAlts){
			for(let i=0;i<newAlts.length;i++){
				oldAlts.push(newAlts[i]);
				let alt = alts[newAlts[i]];
				if(alt){
					alt.main = oldName;
				}
			}
		}
		newEntry.alts = null;
		delete newEntry.alts;
		newEntry.main = oldName;
		saveLeaderboard();
	}
};

let getMain = function(altName){
	let alts = self.data.leaderboard.alts;
	if(alts){
		let alt = alts[normalizeText(altName)];
		if(alt&&alt.main){
			return alt.main;
		}
	}
	return altName;
};

let getMainEntry = function(altName){
	let alts = self.data.leaderboard.alts;
	return alts[getMain(altName)];
};

let transferPoints = function(fromName, toName){
	let from = normalizeText(fromName);
	let to = normalizeText(toName);
	let leaderboard = self.data.leaderboard;
	let fromEntry = leaderboard.players[from];
	let toEntry = leaderboard.players[to];
	if(fromEntry){
		if(toEntry){
			toEntry.score += fromEntry.score;
		}else{
			leaderboard.players[to] = {
				displayName: toName,
				score: fromEntry.score
			};
		}
		fromEntry.score = 0;
	}
	for(let eventname in leaderboard.events){
		let event = leaderboard.events[eventname];
		fromEntry = event.players[from];
		toEntry = event.players[to];
		if(fromEntry){
			if(toEntry){
				toEntry.score += fromEntry.score;
			}else{
				leaderboard.players[to] = {
					displayName: toName,
					score: fromEntry.score
				};
			}
			fromEntry.score = 0;
		}
	}
	saveLeaderboard();
};

let getBlacklistEntry = function(username){
	let leaderboard = self.data.leaderboard;
	let entry = leaderboard.blacklist[username];
	if(entry && entry.duration){
		info(Date.now() - entry.time);
		if(Date.now() - entry.time > entry.duration){
			delete leaderboard.blacklist[username];
			return;
		}
	}
	return entry;
};

let millisToTime = function(millis){
	let seconds = millis/1000;
	let hours = Math.floor(seconds/3600);
	let minutes = Math.floor((seconds-hours*3600)/60);
	let response;
	if(hours>0){
		response = hours + " hour" + (hours === 1 ? "" : "s") + " and " + minutes + " minute" + (minutes === 1 ? "" : "s");
	}else{
		response = minutes + " minute" + (minutes === 1 ? "" : "s");
	}
	return response;
};

let saveLeaderboard = function(){
	let path = "bot_modules/tt/leaderboard.json";
	//let file = fs.openSync(path,'w');
	fs.writeFile(path,JSON.stringify(self.data.leaderboard, null, "\t"), function(){
		//fs.closeSync(file);
	});
};

let loadLeaderboard = function(){
	let path = "bot_modules/tt/leaderboard.json";
	if(fs.existsSync(path)){
		let leaderboard = JSON.parse(fs.readFileSync(path, 'utf8'));
		if(!leaderboard.players){
			leaderboard.players = {};
			saveLeaderboard();
		}
		if(!leaderboard.blacklist){
			leaderboard.blacklist = {};
			saveLeaderboard();
		}
		if(!leaderboard.lastReset){
			leaderboard.lastReset = new Date().toUTCString();
		}
		if(!leaderboard.events){
			leaderboard.events = {};
		}
		if(!leaderboard.alts){
			leaderboard.alts = {};
		}
		if(!leaderboard.pendingAlts){
			leaderboard.pendingAlts = {};
		}
		self.data.leaderboard = leaderboard;
	}else{
		self.data.leaderboard = {players:{}, blacklist:{}, lastReset: new Date().toUTCString(), events: {}};
		saveLeaderboard();
	}
};

let validateConfigs = function(){
	let configs = self.config;
	for(let optionName in defaultConfigs){
		if(typeof configs[optionName] !== typeof defaultConfigs[optionName]){
			configs[optionName] = defaultConfigs[optionName];
		}
	}
	saveConfig("tt");
};

let defaultConfigs = {
	startGameRank: "+",
	endGameRank: "%",
	editScoreRank: "@",
	resetLeaderboardRank: "#",
	manageEventRank: "#"
};
