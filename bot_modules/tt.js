let fs = require("fs");
let self = {js:{},data:{},requiredBy:[],hooks:{},config:{}};
let data = {};
let config = defaultConfigs;
let pgclient = null;
let achievements = null;
let request = require("request");
let spawn = require('child_process').spawn;

const GOVERNING_ROOM = "trivia"
exports.GOVERNING_ROOM = GOVERNING_ROOM

const DELETE_USER_SQL = "DELETE FROM users WHERE id = $1;";
const DELETE_ALT_SQL = "DELETE FROM alts WHERE username = $1;";
const GET_ALTS_SQL = "SELECT username FROM alts WHERE main_id = $1;";
const UPDATE_USER_SQL = "UPDATE users SET display_name = $2, username = $3 WHERE id = $1;";
const UPDATE_MAINS_SQL = "UPDATE alts SET main_id = $2 WHERE main_id = $1;";

const INSERT_LB_SQL = "INSERT INTO tt_leaderboards VALUES($1, $2, CURRENT_TIMESTAMP, $3, true);";
const DELETE_LB_SQL = "DELETE FROM tt_leaderboards WHERE id = $1;";
const GET_LB_SQL = "SELECT lb.id, lb.display_name, lb.created_on, users.display_name AS created_by, lb.enabled FROM tt_leaderboards AS lb LEFT OUTER JOIN users ON lb.created_by = users.id WHERE lb.id = $1;";
const GET_ALL_LB_SQL = "SELECT * FROM tt_leaderboards;";
const GET_ENABLED_LB_SQL = "SELECT * FROM tt_leaderboards WHERE enabled = TRUE;";
const RESET_MAIN_LB_SQL = "UPDATE tt_leaderboards SET created_on = CURRENT_TIMESTAMP, created_by = $1 WHERE id = 'main';";
const UPDATE_LB_SQL = "UPDATE tt_leaderboards SET enabled = $2 WHERE id = $1;";
const ENABLE_ALL_LB_SQL = "UPDATE tt_leaderboards SET enabled = true;";
const DISABLE_ALL_LB_SQL = "UPDATE tt_leaderboards SET enabled = false;";

const GET_LB_ENTRY_SQL = "SELECT lb.points, users.display_name FROM tt_points AS lb LEFT OUTER JOIN users ON lb.id = users.id WHERE lb.id = $1 AND lb.leaderboard = $2;";
const GET_LB_ENTRIES_SQL = "SELECT lb.points, users.display_name, lb.leaderboard FROM tt_points AS lb INNER JOIN users ON lb.id = USERS.id WHERE lb.id = $1;";
const GET_ALL_LB_ENTRIES_SQL = "SELECT lb.points, users.display_name FROM tt_points AS lb LEFT OUTER JOIN users ON lb.id = users.id WHERE leaderboard = $1 AND lb.points > 0 ORDER BY lb.points DESC;";
const LIST_LB_ENTRIES_SQL = "SELECT lb.points, users.display_name FROM tt_points AS lb LEFT OUTER JOIN users ON lb.id = users.id WHERE leaderboard = $1 AND lb.points > 0 ORDER BY lb.points DESC FETCH FIRST _NUMBER_ ROWS ONLY;";
const LIST_ALL_LB_ENTRIES_SQL = "SELECT lb.points, users.display_name FROM tt_points AS lb LEFT OUTER JOIN users ON lb.id = users.id WHERE leaderboard = $1 AND lb.points > 0 ORDER BY lb.points DESC;";
const INSERT_LB_ENTRY_SQL = "INSERT INTO tt_points VALUES ($1, $2, $3);";
const UPDATE_LB_ENTRY_SQL = "UPDATE tt_points SET points = $3 WHERE id = $1 AND leaderboard = $2;";
const DELETE_LB_ENTRY_SQL = "DELETE FROM tt_points WHERE id = $1 AND leaderboard = $2;";
const DELETE_USER_ENTRIES_SQL = "DELETE FROM tt_points WHERE id = $1;";
const DELETE_LB_ENTRIES_SQL = "DELETE FROM tt_points WHERE leaderboard = $1;";

const GET_AVG_POINTS = "SELECT AVG(points) avg_points FROM tt_points WHERE points > 0 AND leaderboard = $1;";
const GET_STD_POINTS = "SELECT STDDEV_POP(points) std_points FROM tt_points WHERE points > 0 AND leaderboard = $1;";
const GET_NUM_PLAYERS = "SELECT COUNT(*) num_players FROM tt_points WHERE points > 0 AND leaderboard = $1;";



//game:{
//	openReason:
//	// 'auth': forced open by an auth
//	// 'leave': automatically opened on player leaving
//	// 'timer': automatically opened for not asking a questions
//	// 'user': opened by the user
//	// ''
//}

//args is [id, leaderboard]
let getLeaderboardEntry = function(args, onEnd, onError){
	let res;
	pgclient.runSql(GET_LB_ENTRY_SQL, [args[0], toId(args[1])], (row)=>{
		res = row;
	}, ()=>{
		if(onEnd) onEnd(res);
	}, onError);
};

//args is [number of entries to get, leaderboard]
let listLeaderboardEntries = function(args, onRow, onEnd, onError){
	pgclient.runSql(LIST_LB_ENTRIES_SQL.replace("_NUMBER_",args[0]), [toId(args[1])], onRow, onEnd, onError);
};

let getAllLeaderboardEntries = function(leaderboard, onEnd, onError){
	let entries = [];
	pgclient.runSql(GET_ALL_LB_ENTRIES_SQL, [toId(leaderboard)], (row)=>{
		entries.push(row);
	}, ()=>{
		onEnd(entries);
	}, onError);
};

//updateFunc takes the old score, and returns what the new score should be
//onEnd takes the old row and new score, and does whatever
//args is [id, leaderboard, display name]
let updateLeaderboardEntryById = function(args, updateFunc, onEnd, onError){
	let res;
	getLeaderboardEntry(args, (res)=>{
		if(!res){
			let newScore = updateFunc(0);
			pgclient.runSql(INSERT_LB_ENTRY_SQL, [args[0], args[1], newScore], null, ()=>{
				if(onEnd){
					achievementsOnScoreUpdate(args[2], args[1], 0, newScore);
					onEnd(res, newScore);
				}
			}, onError);
		}else{
			let newScore = updateFunc(res.points);
			pgclient.runSql(UPDATE_LB_ENTRY_SQL, [args[0], args[1], newScore], null, ()=>{
				if(onEnd){
					achievementsOnScoreUpdate(args[2], args[1], res.points, newScore);
					onEnd(res, newScore);
				}
			}, onError);
		}
	}, onError);
};

let updateLeaderboardEntryByUsername = function(args, updateFunc, onEnd, onError){
	pgclient.getId(args[0], true, (res)=>{
		updateLeaderboardEntryById([res.id, args[1], res.display_name], updateFunc, onEnd, onError);
	}, onError);
};

let checkPendingUpdates = function(shouldStart){
	if(data.pendingUpdates.length === 1 || shouldStart && data.pendingUpdates.length > 0){
		let entry = data.pendingUpdates[0];
		updateAllLeaderboardEntriesById(entry.id, entry.username, entry.updateFunc, entry.onEnd, entry.onError);
	}
};

//updateFunc takes the old score, and returns what the new score should be
//onEnd takes the user id, rows updated, array of events failed
let updateAllLeaderboardEntriesById = function(id, username, updateFunc, onEnd, onError){
	let events = [];
	pgclient.runSql(GET_ENABLED_LB_SQL, [], (row)=>{
		events.push(row);
	}, ()=>{
		let entries = {};
		pgclient.runSql(GET_LB_ENTRIES_SQL, [id], (row)=>{
			entries[row.leaderboard] = row;
		}, ()=>{
			events = events.map((event)=>{return event.id});
			let	pendingEvents = events.length;
			let failed = [];
			let newEnd = (event)=>{
				return ()=>{
					pendingEvents--;
					if(pendingEvents===0){
						if(onEnd) onEnd(id, events.length - failed.length, failed);
						data.pendingUpdates.shift();
						checkPendingUpdates(true);
					}
				};
			};
			let newError = (event)=>{
				return (err)=>{
					error(err);
					pendingEvents--;
					failed.push(event);
					if(pendingEvents===0){
						if(onEnd) onEnd(id, events.length - failed.length, failed);
						data.pendingUpdates.shift();
						checkPendingUpdates(true);
					}
				};
			};
			for(let i=0;i<events.length;i++){
				if(entries[events[i]]){
					pgclient.runSql(UPDATE_LB_ENTRY_SQL, [id, events[i], updateFunc(entries[events[i]].points)], null, newEnd(events[i]), newError(events[i]));
					achievementsOnScoreUpdate(username, events[i], entries[events[i]].points, updateFunc(entries[events[i]].points));
				}else{
					pgclient.runSql(INSERT_LB_ENTRY_SQL, [id, events[i], updateFunc(0)], null, newEnd(events[i]), newError(events[i]));
					achievementsOnScoreUpdate(username, events[i], 0, updateFunc(0));
				}
			}
			if(events.length === 0) onEnd(id, 0, 0);
		}, onError);
	}, onError);
}

let updateAllLeaderboardEntriesByUsername = function(username, updateFunc, onEnd, onError){
	pgclient.getId(username, true, (res)=>{
		data.pendingUpdates.add({id: res.id, username: res.display_name, updateFunc: updateFunc, onEnd: (id, affected, failed)=>{
			if(onEnd) onEnd(res.display_name, affected, failed);
		}, onError: onError});
		checkPendingUpdates();
		// updateAllLeaderboardEntriesById(res.id, res.display_name, updateFunc, (id, affected, failed)=>{
		// 	if(onEnd) onEnd(res.display_name, affected, failed);
		// }, onError);
	}, onError);
}

//args is [id, leaderboard]
let removeLeaderboardEntry = function(args, onEnd, onError){
	let res;
	getLeaderboardEntry(args, (res)=>{
		if(!res){
			onEnd(res);
		}else{
			pgclient.runSql(DELETE_LB_ENTRY_SQL, args, ()=>{}, ()=>{
				if(onEnd){
					onEnd(res);
				}
			}, onError);
		}
	}, onError);
};

let removeAllLeaderboardEntries = function(id, onEnd, onError){
	pgclient.runSql(DELETE_USER_ENTRIES_SQL, [id], null, onEnd, onError);
}

// 1) Get all achievements of fromId and toId
// 2) For each achievement, if it doesn't exist on toId change the id to toId. If it does exist, update the date on toId to be the earlier date
// 3) Remove all
let transferAllAchievements = function(fromId, toId, onEnd, onError){
	let success = true;
}

let transferAllPoints = function(fromId, toId, onEnd, onError, onAllFinished){
	let success = true;
	let fromEntries = {};
	let entriesToTransfer = 0;
	pgclient.runSql(GET_LB_ENTRIES_SQL, [fromId], (row)=>{
		fromEntries[row.leaderboard] = row;
		entriesToTransfer++;
	}, ()=>{
		let toEntries = {};
		pgclient.runSql(GET_LB_ENTRIES_SQL, [toId], (row)=>{
			toEntries[row.leaderboard] = row;
		}, ()=>{
			if(entriesToTransfer === 0){
				onAllFinished(success);
				return;
			}
			let endFunc = ()=>{
				entriesToTransfer--;
				if(onEnd) onEnd();
				if(entriesToTransfer === 0) onAllFinished(success);
			}
			let errorFunc = (err)=>{
				entriesToTransfer--;
				success = false;
				error(err.message);
				if(entriesToTransfer === 0) onAllFinished(success);
			}
			removeAllLeaderboardEntries(fromId);
			for(let event in fromEntries){
				if(toEntries[event]){
					pgclient.runSql(UPDATE_LB_ENTRY_SQL, [toId, event, toEntries[event].points + fromEntries[event].points], null, endFunc, errorFunc);
				}else{
					pgclient.runSql(INSERT_LB_ENTRY_SQL, [toId, event, fromEntries[event].points], null, endFunc, errorFunc);
				}
			}
		}, onError);
	}, onError);
};

let changeMains = function(id, newName, onEnd, onError){
	pgclient.runSql(UPDATE_USER_SQL, [id, newName, toId(newName)], null, onEnd, onError);
}

// Merges two alts, and their points
let mergeAlts = function(fromName, toName, onEnd, onError){
	pgclient.getMains(fromName, toName, true, (res)=>{
		if(res[0].id === res[1].id){
			onError("Those two accounts are the same.");
			return;
		}
		transferAllPoints(res[0].id, res[1].id, null, null, (success)=>{
			if(success){
				pgclient.runSql(UPDATE_MAINS_SQL, [res[0].id, res[1].id], null, ()=>{
					pgclient.runSql(DELETE_USER_SQL, [res[0].id], null, ()=>{
						onEnd();
					}, onError);
				}, onError);
			}else{
				if(onError){
					onError("One of the updates failed.");
				}
			}
		});
	}, onError);
};

exports.onLoad = function(module, loadData, oldData){
	self = module;
	refreshDependencies();
	if(oldData) data = oldData;
	if(loadData){
		data = {
			games: {},
			pendingAlts: {},
			askToReset: "",
			timers: {},
			tempVoices: {},
			flags: {},
			pendingUpdates: []
		};
		loadFacts();
		loadBatches();
		loadLeaderboard();
	}
	self.chathooks = {
		chathook: function(room, user, message){
			let game = data.games[room.id];
			if(!game) return;
			let triviaRank = AuthManager.getRank(user, RoomManager.getRoom("trivia"));

			if(game.bpOpen){
				let text = toId(message);
				if(text === "bp" || text === "me" || text === "bpme"){
					tryBatonPass(game, user, user, {active:user}, false, false, config.remindTime/2);
				}
			}else if((AuthManager.rankgeq(triviaRank, config.manageBpRank) || user.id === game.curUser.id) && (/\*\*([^\s].*)?veto(.*[^\s])?\*\*/i.test(message) || /^\/announce .*veto.*/i.test(message)) && user.id !== toId(mainConfig.user)){
				if(game.curHist.hasAsked){
					game.curHist.hasAsked = false;
					clearTimers(game);
					game.remindTimer = setTimeout(()=>{
						onRemind(game);
					}, config.remindTime*1000/2);
				}

				if(AuthManager.rankgeq(triviaRank, config.manageBpRank) && (/boldfail/i.test(toId(message)))){
					room.broadcast(user, "!rfaq bold");
				}

			}else if(user.id === game.curUser.id && /\*\*(([^\s])|([^\s].*[^\s]))\*\*/g.test(message)){
				clearTimers(game);
				game.curHist.hasAsked = true;
			}
			if(game && data.flags["timer"] && /\*\*(([^\s])|([^\s].*[^\s]))\*\*/g.test(message)){
				if(game.blitzTimer){
					clearTimeout(game.blitzTimer);
					game.blitzTimer = null;
				}
				game.blitzTimer = setTimeout(()=>{
					game.blitzTimer = null;
					room.send("/wall Timer's up!");
				}, data.flags["timer"]*1000);
				room.send("Set the timer for " + data.flags["timer"] + " seconds.");
			}
		}
	};
};

exports.onUnload = function(){
	for(let roomid in data.games){
		clearTimers(data.games[roomid], true);
	}
};
let refreshDependencies = function(){
	//chat = getModuleForDependency("chat", "tt");
	//auth = getModuleForDependency("auth", "tt");
	//rooms = getModuleForDependency("rooms", "tt");
	pgclient = getModuleForDependency("pgclient", "tt");
	achievements = getModuleForDependency("achievements", "tt");
};
exports.refreshDependencies = refreshDependencies;
exports.onConnect = function(){

};
exports.getData = function(){
	return data;
}
exports.getConfig = function(){
	return config;
}
exports.setConfig = function(newConfig){
	config = newConfig;
}

let processJoin = function(room, user){
	let game = data.games[room.id];
	if(game && (game.timeout || game.bpOpen === "leave") && user.id === game.curUser.id){
		if(game.timeout){
			clearTimeout(game.timeout);
			game.timeout = null;
		}
		if(game.bpOpen == "leave"){
			game.bpOpen = null;
			room.send("**" + user.name + " has rejoined, so BP is no longer open.**");
		}
	}
}
self.processJoin = processJoin;
exports.processJoin = processJoin;

let processLeave = function(room, user){
	let game = data.games[room.id];
	// if(game) info(JSON.stringify(game.curUser));
	if(game && user.id === game.curUser.id){
		if(!game.bpOpen){
			game.timeout = setTimeout(function(){
				if(!game.bpOpen && !game.bpLocked){ // if bp is locked dont change it
					game.bpOpen = "leave";
					game.timeout = null;
					room.send("**" + game.curUser.name + " has left, so BP is now open (say 'me' or 'bp' to claim it).**");
				}
			}, config.leaveGraceTime*1000);
		}
	}
}
self.processLeave = processLeave;
exports.processLeave = processLeave;

let processName = function(room, user){
	let game = data.games[room.id];
	if(game && user.id === game.curUser.id){
		if( (user.trueRank === "‽" || user.trueRank === "!") && !game.bpLocked){ // Let's go ahead and open BP if the user is muted or locked
			// but we can't open BP if it's locked!
			if(!game.bpOpen){
				room.send("**BP is now open (say 'me' or 'bp' to claim it).**");
			}
			game.bpOpen = "auth";
		}
	}
}
self.processName = processName;
exports.processName = processName;

let processHide = function(room, user){
	let game = data.games[room.id];
	if(game && user.id === game.curUser.id && !game.bpLocked){ // can't open BP if it's locked
		// The user must've done something very bad so opening BP is probably a good idea
		if(!game.bpOpen){
			room.send("**BP is now open (say 'me' or 'bp' to claim it).**")
		}
		game.bpOpen = "auth";
	}
}
self.processHide = processHide;
exports.processHide = processHide;


let commands = {

	// newgame, endgame
	tt: function(message, args, user, rank, room, commandRank, commandRoom){
		if(args.length>0){
			let command = args[0].toLowerCase();
			if(ttCommands[command]){
				ttCommands[command](message, args, user, rank, room, commandRank, commandRoom);
			}
		}
	},
	// list, check, set, add, remove, reset, lastreset, event
	ttl: "ttleaderboard",
	ttleaderboard: function(message, args, user, rank, room, commandRank, commandRoom){
		if(args.length>0){
			let command = args[0].toLowerCase();
			if(ttleaderboardCommands[command]){
				ttleaderboardCommands[command](message, args, user, rank, room, commandRank, commandRoom);
			}
		}
	},
	event: function(message, args, user, rank, room, commandRank, commandRoom){
		if(args.length>0){
			let command = args[0].toLowerCase();
			if(ttleaderboardEventCommands[command]){
				ttleaderboardEventCommands[command](message, args, user, rank, room, commandRank, commandRoom);
			}
		}
	},
	yea: "yes", yup: "yes", sure: "yes", yee: "yes", yep: "yes", yeah: "yes",
	hellyeah: "yes", ofcourse: "yes", butofcourse: "yes", go: "yes",
	oui: "yes", si: "yes", right: "yes",
	aye: "yes", ya: "yes", ye: "yes", correct: "yes", ja: "yes",
	indeed: "yes", damnright: "yes",
	yes: function(message, args, user, rank, room, commandRank, commandRoom){
		let hasRank = AuthManager.rankgeq(commandRank, config.manageBpRank)
		let shouldUndo = hasRank && toId(args[1]) === "afk";
		let roomId = !shouldUndo && hasRank && args[1] ? toRoomId(args[1]) : room.id;
		let game = data.games[roomId];
		if(!game){
			room.broadcast(user, "There is no trivia game in " + roomId + ".");
		}else if(!toId(args[0])){
			room.broadcast(user, "You must specify a player.");
		}else if(!hasRank && game.curUser.id !== user.id){
			room.broadcast(user, "You either are not the active user or do not have a high enough rank to use this command.");
		}else if(!hasRank && game.bpLocked){
			room.broadcast(user, "You cannot ask questions or use ~yes while BP is locked.");
		}else if(!hasRank && game.bpOpen){
			room.broadcast(user, "You cannot ~yes while BP is open.");
		}else if(!hasRank && !game.history[game.history.length-1].hasAsked){
			room.broadcast(user, "You must ask a question in bold before you use ~yes. If your question was veto'd, please ask a new one or discuss it with a staff member.");
		}else{
			let nextPlayer = game.room.getUserData(toId(args[0]));
			if(!nextPlayer){
				room.broadcast(user, "That user is not in the room.");
			}else{
				let asker = game.curUser.id;
				let answerer = nextPlayer.id;
				let success = tryBatonPass(game, user, nextPlayer, {active:nextPlayer, undoAsker:function(){
					updateAllLeaderboardEntriesByUsername(asker, (oldPoints)=>{
						return Math.max(oldPoints - config.askPoints, 0);
					});
				}, undoAnswerer: function(){
					updateAllLeaderboardEntriesByUsername(answerer, (oldPoints)=>{
						return Math.max(oldPoints - config.answerPoints, 0);
					});
				}}, false, shouldUndo);
				if(success){
					updateAllLeaderboardEntriesByUsername(asker, (oldPoints)=>{
						return oldPoints + config.askPoints;
					});
					updateAllLeaderboardEntriesByUsername(answerer, (oldPoints)=>{
						return oldPoints + config.answerPoints;
					});
				}
			}
		}
	},
	nah: "no",
	nope: "no",
	no: function(message, args, user, rank, room, commandRank, commandRoom){
		let roomId = AuthManager.rankgeq(commandRank, config.manageBpRank) && args[1] ? toRoomId(args[1]) : room.id;
		let number = args[0] && /^\d+$/.test(args[0]) ? parseInt(args[0],10) : 1;
		let game = data.games[roomId];
		if(!game){
			room.broadcast(user, "There is no trivia game in " + roomId + ".");
		}else if(AuthManager.rankgeq(commandRank, config.manageBpRank) || (user.id === game.curUser.id && number === 1)){
			if(game.lastNo && Date.now() - game.lastNo < 5000){
				room.broadcast(user, "There is a cooldown between uses of ~no, try again in a few seconds.");
			}else{
				game.lastNo = Date.now();
				let i;
				for(i=0;i<number && game.history.length>0;i++){
					let curHist = game.history.pop();
					if(curHist.undoAsker) curHist.undoAsker();
					if(curHist.undoAnswerer) curHist.undoAnswerer();
				}
				let response = "**Undid " + i + " action(s)";
				clearTimers(game);
				game.bpOpen = null;
				// if we're undoing actions, we probably want BP to be unlocked.
				game.bpLocked = null;
				if(game.history.length>0){
					game.curHist = game.history[game.history.length-1];
					let newUser = game.curHist.active;
					let newNewUser = game.room.getUserData(newUser.id);
					if(newNewUser){
						game.curUser = newNewUser;
						if(newNewUser.rank === "!" || newNewUser.rank === "‽"){
							response += ". Since " + newNewUser.name + " is muted or locked, BP is open.**";
							game.bpOpen = "auth";
						}else{
							response += ", it is now " + newNewUser.name + "'s turn to ask a question.**";
						}
					}else{
						game.curUser = newUser;
						response += ". Since " + newUser.name + " is not in the room, BP is open.**";
						game.bpOpen = "auth";
					}
				}else{
					game.curHist = {active: user};
					game.history = [game.curHist]
					game.curUser = user;
					response += ". Since the end of the history was reached, BP is open.**";
					game.bpOpen = "auth";
				}
				if(!game.bpOpen){
					game.remindTimer = setTimeout(()=>{
						onRemind(game);
					}, config.remindTime*1000);
				}
				game.room.send(response);
			}
		}else{
			room.broadcast(user, "You are either not the active user or do not have a high enough rank to use this command.");
		}
	},
	bp: function(message, args, user, rank, room, commandRank, commandRoom){
		let roomId = toRoomId(args[1]) || "trivia";
		if(!data.games[roomId]){
			room.broadcast("There is no trivia game in " + roomId + ".");
		}else{
			let game = data.games[roomId];
			let id = toId(args[0]);
			if(!id || !AuthManager.rankgeq(commandRank, config.manageBpRank)){
				let lastActive = game.curUser.name;
				// if BP is open or locked, there's no need to HL the user who last had it.
				room.broadcast(user,
					(game.bpOpen || game.bpLocked ? "__" + lastActive + "__" : lastActive)
					+ " has BP" + (game.bpOpen ? " (BP is open)" : "")
					+ (game.bpLocked ? " (BP is locked)." : "."));
			}else{
				let nextUser = game.room.getUserData(id);
				if(!nextUser){
					room.broadcast(user, "That user is not in the room.");
				}else{
					let result = tryBatonPass(game, user, nextUser, {active: nextUser}, false, false, null, true);
				}

			}
		}
	},
	lockbp: "bplock",
	bplock: function(message, args, user, rank, room, commandRank, commandRoom){
		let roomId = room && room.id ? room.id : toRoomId(args[0]);
		if(!roomId){
			user.send("You must specify a room.");
		}else if(!data.games[roomId]){
			room.broadcast(user, "There is no game in " + roomId + ".");
		}else{
			let game = data.games[roomId];
			let gameRoom = game.room;
			let lastActive = game.curUser;
			// I'm making it so that only auth can lock BP - since it's only for
			// hosting minigames/fish, no regs should have need of it.
			if(AuthManager.rankgeq(commandRank, config.manageBpRank)){
				if(game.bpOpen){
					// BP shouldn't be open and locked at the same time—that doesn't make sense
					gameRoom.send("BP is open — please claim it or close BP before locking BP.");
				}else if(!game.bpLocked){
					game.bpLocked = true;
					gameRoom.send("**BP is now locked; no one can ask questions.**");
				}else{
					room.broadcast(user,"BP is already locked.");
				}
			}else{
				room.broadcast(user, "You are not ranked high enough to lock BP.")
			}
		}
	},
	unlockbp: "bpunlock",
	bpunlock: function(message, args, user, rank, room, commandRank, commandRoom){
		let roomId = room && room.id ? room.id : toRoomId(args[0]);
		if(!roomId){
			user.send("You must specify a room.");
		}else if(!data.games[roomId]){
			room.broadcast(user, "There is no game in " + roomId + ".");
		}else{
			let game = data.games[roomId];
			let gameRoom = game.room;
			if(AuthManager.rankgeq(commandRank, config.manageBpRank)){
				if(game.bpLocked){
					game.bpLocked = null;
					game.bpOpen = null;
					let lastActive = game.curUser.name;
					if(game.room.getUserData(toId(lastActive))){ // if the user's in the room
						game.timeout = null;
						game.remindTimer = setTimeout(()=>{
							onRemind(game);
						}, config.remindTime*1000);
						gameRoom.send("**BP is now unlocked; " + lastActive + " has BP.**");
					}else{ // not in the room, so open BP due to leaving
						game.bpOpen = "leave";
						game.timeout = null;
						gameRoom.send("**BP is now unlocked; " + lastActive + " has left, so BP is now open (say 'me' or 'bp' to claim it).**");
					}
				}else{
					room.broadcast(user, "BP is not locked.");
				}
			}else{
				room.broadcast(user, "Either BP is not locked or you do not have permission to unlock it.");
			}
		}
	},

	openbp: "bpopen",
	bpopen: function(message, args, user, rank, room, commandRank, commandRoom){
		let roomId = room && room.id ? room.id : toRoomId(args[0]);
		if(!roomId){
			user.send("You must specify a room.");
		}else if(!data.games[roomId]){
			room.broadcast(user, "There is no game in " + roomId + ".");
		}else{
			let game = data.games[roomId];
			let gameRoom = game.room;
			let lastActive = game.curUser;
			if(game.bpLocked){ // Opening BP while it's locked makes no sense.
				gameRoom.send("You cannot open BP while BP is locked.");
			}else if(lastActive.id === user.id){
				if(!game.bpOpen){
					game.bpOpen = "user";
					gameRoom.send("**BP is now open (say 'me' or 'bp' to claim it).**");
				}else{
					room.broadcast(user, "BP is already open.");
				}
			}else if(AuthManager.rankgeq(commandRank, config.manageBpRank)){
				if(!game.bpOpen){
					game.bpOpen = "auth";
					gameRoom.send("**BP is now open (say 'me' or 'bp' to claim it).**");
				}else if(game.bpOpen !== "auth"){
					game.bpOpen = "auth";
				}else{
					room.broadcast(user,"BP is already open.");
				}
			}else{
				room.broadcast(user, "You are either not the active player or not ranked high enough to open BP.")
			}
		}
	},
	closebp: "bpclose",
	bpclose: function(message, args, user, rank, room, commandRank, commandRoom){
		let roomId = room && room.id ? room.id : toRoomId(args[0]);
		if(!roomId){
			user.send("You must specify a room.");
		}else if(!data.games[roomId]){
			room.broadcast(user, "There is not game in " + roomId + ".");
		}else{
			let game = data.games[roomId];
			let gameRoom = game.room;
			if(AuthManager.rankgeq(commandRank, config.manageBpRank) || (game.curUser.id === user.id && game.bpOpen === "user")){
				if(game.bpOpen){
					game.bpOpen = null;
					gameRoom.send("**BP is now closed.**");
				}else{
					room.broadcast(user, "BP is not open. Timers have been cleared.");
				}
				clearTimers(game);
			}else{
				room.broadcast(user, "Either BP is not open or you do not have permission to close it.");
			}
		}
	},
	//~ttblacklist add/remove/check, [user], {duration}, {reason}
	ttbl: "ttblacklist",
	ttblacklist: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank,config.manageBlRank)){
			room.broadcast(user, "Your rank is not high enough to use the blacklist command.");
		}else if(args.length < 2){
			room.broadcast(user, "Not enough arguments were given for the blacklist command.");
		}else{
			let command = toId(args[0]);
			let id = toId(args[1]);
			let duration = /^\d+$/.test(args[2]) ? parseInt(args[2]) : 0;
			let reason = args[3] || "No reason given";
			if(!id){
				room.broadcast(user, "You must specify a user.");
			}else if(!blacklistCommands[command]){
				room.broadcast(user, command + " is not a recognized command.");
			}else{
				blacklistCommands[command](args[1], id, duration, reason, user, room, commandRoom);
			}
		}
	},
	ttmute: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank,'%')){
			room.broadcast(user, "Your rank is not high enough to use the mute commands.");
		}else{
			let id = toId(args[0]);
			let duration = 7
			let reason = args[1] || "No reason given";
			if(!id){
				room.broadcast(user, "You must specify a user.");
			}else{
				blacklistCommands['add'](args[0], id, duration, reason, user, room, commandRoom);
			}
		}
	},
	tthourmute: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank,'%')){
			room.broadcast(user, "Your rank is not high enough to use the mute commands.");
		}else{
			let id = toId(args[0]);
			let duration = 60
			let reason = args[1] || "No reason given";
			if(!id){
				room.broadcast(user, "You must specify a user.");
			}else{
				blacklistCommands['add'](args[0], id, duration, reason, user, room, commandRoom);
			}
		}
	},
	ttunmute: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank,'%')){
			room.broadcast(user, "Your rank is not high enough to use the mute commands.");
		}else{
			let id = toId(args[0]);
			let duration;
			let reason;
			if(!id){
				room.broadcast(user, "You must specify a user.");
			}else{
				blacklistCommands['unmute'](args[0], id, duration, reason, user, room, commandRoom);
			}
		}
	},
	alts: function(message, args, user, rank, room, commandRank, commandRoom){
		let target = toId(args[0]) ? args[0] : user.name;
		pgclient.getMains(user.id, target, false, (res)=>{
			if(!AuthManager.rankgeq(commandRank, "%") && (!res[0] || !res[1] || (res[0].id !== res[1].id))){
				room.broadcast(user, "Your rank is not high enough to check other users' alts.")
			}else if(!res[1]){
				room.broadcast(user, target + " does not have any alts.");
			}else{
				let alts = [];
				pgclient.runSql(GET_ALTS_SQL, [res[1].id], (row)=>{
					alts.push(row);
				}, ()=>{
					alts = alts.map((alt)=>{return alt.username});
					if(alts.length === 0){
						room.broadcast(user, target + " does not have any alts");
					}else if(alts.length < 11){
						room.broadcast(user, res[1].display_name + "'s alts: " + alts.join(", "));
					}else{
						let text = res[1].display_name + "'s alts:\n\n" + alts.join("\n");
						uploadText(text, (address)=>{
							room.broadcast(user, "There were more than 10 alts, so they were put into a text file: " + address);
						}, (error)=>{
							room.broadcast(user, "There was an error while saving the file. Here are the first 6 alts of " + alts.length + ": " + alts.slice(0,6).join(", "));
						});
					}
				}, (err)=>{
					error(err);
					room.broadcast(user, "Something went wrong finding " + target + "'s alts.");
				});
			}
		}, (err)=>{
			error(err);
			room.broadcast(user, "There was an error verifying your main account.");
		});
	},
	alt: function(message, args, user, rank, room, commandRank, commandRoom){
		let pendingAlts = data.pendingAlts;
		if(args.length === 0){
			room.broadcast(user, "You must specify an alt.");
		}else{
			let userId = user.id;
			let altuser = toId(args[0]);
			if(pendingAlts[altuser] && pendingAlts[altuser].indexOf(userId)>-1){
				mergeAlts(altuser, userId, ()=>{
					pendingAlts[altuser].splice(pendingAlts[altuser].indexOf(userId),1);
					if(pendingAlts[altuser].length === 0){
						delete pendingAlts[altuser];
					}
					room.broadcast(user, "Successfully linked accounts.");
				}, (err)=>{
					error(JSON.stringify(err));
					room.broadcast(user, "There was an error while linking accounts: " + JSON.stringify(err));
				});
			}else{
				if(!pendingAlts[userId]){
					pendingAlts[userId] = [];
				}
				if(pendingAlts[userId].indexOf(altuser) === -1){
					pendingAlts[userId].push(altuser);
				}
				room.broadcast(user, "Now say \"~alt " + user.name + "\" on that account to link them. Make sure all your linked accounts are registered or your points may be at risk.");
			}
		}
	},
	removealt: function(message, args, user, rank, room, commandRank, commandRoom){
		let canEditOthers = AuthManager.rankgeq(commandRank, "@");
		if(args.length===0 || !args[0]){
			room.broadcast(user, "You must specify an alt.");
		}else{
			pgclient.getMains(user.id, args[0], idsMatch(args[0], user.id), (res)=>{
				if(!res[0] && !canEditOthers){
					room.broadcast(user, "You do not have any alts.");
				}else if(!res[1]){
					room.broadcast(user, "That account has no alts.");
				}else if(res[0].id !== res[1].id && !canEditOthers){
					room.broadcast(user, "That account is not an alt of yours.");
				}else if(idsMatch(args[0], res[1].display_name)){
					if(res[0].id !== res[1].id){
						room.broadcast(user, "You cannot remove their main account.");
					}else{
						room.broadcast(user, "You cannot remove your main account.");
					}
				}else{
					pgclient.runSql(DELETE_ALT_SQL, [toId(args[0])], null, (res)=>{
						if(res.rowCount === 0){
							room.broadcast(user, "That's weird, the query didn't delete anything. Something is probably wrong.");
						}else{
							room.broadcast(user, "Successfully removed the alt.");
						}
					}, (err)=>{
						error(err);
						room.broadcast(user, "There was an error removing the alt.");
					})
				}
			}, (err)=>{
				error(err);
				room.broadcast(user, "Something went wrong when finding your main.");
			});
		}
	},
	main: function(message, args, user, rank, room, commandRank, commandRoom){
		let canEditOthers = AuthManager.rankgeq(commandRank, "@");
		if(args.length===0 || !args[0]){
			room.broadcast(user, "You must specify an alt.");
		}else if(args[0].length>20){
			room.broadcast(user, "That name is too long.");
		}else{
			pgclient.getMains(user.id, args[0], idsMatch(args[0], user.id), (res)=>{
				if(!res[0] && !canEditOthers){
					room.broadcast(user, "You do not have any alts.");
				}else if(!res[1]){
					room.broadcast(user, "That account has no alts.");
				}else if(res[0].id !== res[1].id && !canEditOthers){
					room.broadcast(user, "That account is not one of your alts.");
				}else{
					changeMains(res[1].id, removeFormatting(removeRank(args[0])), ()=>{
						if(!res[0].id || res[0].id !== res[1].id){
							room.broadcast(user, "Their name was successfully changed.");
						}else{
							room.broadcast(user, "Your name was successfully changed.");
						}
					}, (err)=>{
						error(JSON.stringify(err));
						if(res[0].id !== res[1].id){
							room.broadcast(user, "There was an error while changing their main account name.");
						}else{
							room.broadcast(user, "There was an error while changing your main account name.");
						}
					});
				}
			}, (err)=>{
				error(err);
				room.broadcast(user, "Something went wrong when finding your main.");
			});
		}
	},
	removeformatting: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank,"@")){
			user.send("You rank isn't high enough to do that.");
		}else if (args.length < 1){
			user.send("You need to give a player to fix.");
		}else{
			let id = toId(args[0]);
			pgclient.getId(id, false, (row)=>{
				if(!row){
					user.send("That user does not have an entry.");
				}else{
					changeMains(row.id, id, ()=>{
						room.broadcast(user, "Successfully reset the main mane.");
					}, (err)=>{
						error(err);
						user.send("Something went wrong when updating the main.");
					});
				}
			}, (err)=>{
				error(err)
				user.send("Something went wrong when finding the main account.");
			});
		}
	},
	ttlload: function(message, args, user, rank, room, commandRank, commandRoom){
		if(AuthManager.rankgeq(commandRank,"@")){
			loadLeaderboard();
			room.broadcast(user, "Loaded leaderboard.");
		}
	},
	ttlsave: function(message, args, user, rank, room, commandRank, commandRoom){
		if(AuthManager.rankgeq(commandRank,"@")){
			saveLeaderboard();
			room.broadcast(user, "Saved leaderboard.");
		}
	},
	//~timer [seconds], {message}, {room}
	//~timer end, {room}
	timer: function(message, args, user, rank, room, commandRank, commandRoom){
		let arg = toId(args[0]);
		if(arg === "end"){
			let roomId = toRoomId(args[1]) || room.id;
			rank = AuthManager.getRank(user, RoomManager.getRoom(roomId));
			if(!AuthManager.rankgeq(rank, config.timerRank)){
				user.send("Your rank is not high enough to manage timers.");
			}else{
				let timerName = "room:" + roomId;
				if(!roomId){
					user.send("You must specify a room.");
				}else if(!data.timers[timerName]){
					user.send("There isn't a timer for " + roomId + ".");
				}else{
					clearTimeout(data.timers[timerName].timer);
					delete data.timers[timerName];
					room.broadcast(user, "Successfully cleared the timer for " + roomId + ".");
				}
			}
		}else if(/^\d+$/.test(arg)){
			let roomId = toRoomId(args[2]) || room.id;
			rank = AuthManager.getRank(user, RoomManager.getRoom(roomId));
			if(!AuthManager.rankgeq(rank, config.timerRank)){
				user.send("Your rank is not high enough to manage timers.");
			}else{
				let timerName = "room:" + roomId;
				let duration = Math.max(parseInt(arg, 10),1);
				let endMessage = args[1] ? "/wall " + args[1] : "/wall Timer's up!";
				if(data.timers[timerName]) clearTimeout(data.timers[timerName].timer);
				data.timers[timerName] = {
					room: roomId,
					timer: setTimeout(()=>{
						delete data.timers[timerName];
						room = RoomManager.getRoom(roomId);
						if(room) room.send(endMessage);
					}, duration*1000)
				};
				room.broadcast(user, "Set the timer for " + Math.floor(duration/60) + " minute(s) and " + (duration%60) + " second(s).");
			}
		}else{
			user.send("The first argument must be either 'end' or an integer.");
		}
	},
	//~ttbtimer [min seconds], [max seconds], {message}, {room}
	ttbtimer: function(message, args, user, rank, room, commandRank, commandRoom){
		let arg0 = toId(args[0]);
		let arg1 = toId(args[1]);
		let roomId = toRoomId(args[3]) || room.id;
		let targetRoom = RoomManager.getRoom(roomId);
		rank = AuthManager.getRank(user, targetRoom);
		if(!roomId || !targetRoom){
			user.send("You must specify a room that I am in.");
		}if(!AuthManager.rankgeq(rank, config.timerRank)){
			user.send("Your rank is not high enough to manage timers.");
		}else if(/^\d+$/.test(arg0) && /^\d+$/.test(arg1)){
			let timerName = "room:" + roomId;
			let minTime = parseInt(arg0);
			let maxTime = parseInt(arg1);
			let duration = Math.max(Math.round(Math.random()*(maxTime-minTime)+minTime),1);
			let endMessage = args[2] ? "/wall " + args[2] : "/wall Timer's up!";
			if(data.timers[timerName]) clearTimeout(data.timers[timerName].timer);
			data.timers[timerName] = {
				room: roomId,
				timer: setTimeout(()=>{
					delete data.timers[timerName];
					targetRoom.send(endMessage);
				}, duration*1000)
			};
			user.send("Set the timer for " + Math.floor(duration/60) + " minute(s) and " + (duration%60) + " second(s).");
		}else{
			user.send("You must give a minimum and a maximum time.");
		}
	},
	addfact: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank,config.factRank)){
			room.broadcast(user, "Your rank is not high enough to edit facts.");
		}else if(!args.length){
			room.broadcast(user, "You need to give a fact to add.");
		}else{
			let fact = message.substr(9);
			let factId = toId(fact);
			if(data.facts.filter(f=>{return f.id == factId}).length){
				room.broadcast(user, "That fact already exists.");
			}else{
				data.facts.add({text: fact, id: factId});
				saveFacts();
				room.broadcast(user, "Successfully added the fact.");
			}
		}
	},
	deletefact: "removefact",
	removefact: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank,config.factRank)){
			room.broadcast(user, "Your rank is not high enough to edit facts.");
		}else if(!args.length){
			room.broadcast(user, "You need to give a fact to remove.");
		}else{
			let fact = message.substr(12);
			let factId = toId(fact);
			let num = data.facts.length;
			data.facts = data.facts.filter(f=>{return f.id !== factId});
			if(data.facts.length === num){
				room.broadcast(user, "That fact does not exist.");
			}else{
				saveFacts();
				room.broadcast(user, "Successfully removed the fact.");
			}
		}
	},
	randfact: "fact",
	randomfact: "fact",
	fact: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, config.factRank)){
			room.broadcast(user, "Your rank is not high enough to check facts.");
		}else if(data.facts.length){
			room.broadcast(user, "__" + data.facts[Math.floor(Math.random()*data.facts.length)].text + "__");
		}else{
			room.broadcast(user, "There are no facts :<");
		}
	},
	facts: "factlist",
	factlist: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, config.factRank)){
			room.broadcast(user, "Your rank is not high enough to manage facts.");
		}else if(data.facts.length){
			let text = data.facts.map(f=>{return f.text}).join("\n\n");
			uploadText(text, (link)=>{
				user.send("Here is a list of all the facts: " + link);
			}, (err)=>{
				user.send("There was an error: " + err);
			});
		}else{
			user.send("There are no facts :<");
		}
	},
	minigamelist: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, config.batchRank)){
			room.broadcast(user, "Your rank is not high enough to manage query batches.");
		}else if(true){
			let text = JSON.stringify(data.batches, null, "\t");
			uploadText(text, (link)=>{
				user.send("Here is a list of all the batches: " + link);
			}, (err)=>{
				user.send("There was an error: " + err);
			});
		}else{
			room.broadcast(user, "There are no query batches :<");
		}
	},
	//TODO: When a proper text upload method is implemented, redo this
	minigameupdate: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, config.batchRank)){
			user.send("Your rank is not high enough to manage query batches.");
		}else if(args.length < 1){
			user.send("You must give a link to the query batches.");
		}else if(/^(https?:\/\/)?(www\.)?hastebin.com\/raw\/[a-z]+$/.test(args[0])){
			success = true;
			request.get(args[0],function(err, response, body){
				if(err){
						error(err);
						user.send(err);
						return;
				}
				try{
					data.batches = JSON.parse(body);
					saveBatches();
					user.send("Updated the query batches.");
				}catch(e){
					error(e);
					user.send("There was an error parsing the text in the hastebin link.");
				}
			});
		}else{
			user.send("There was something wrong with your link, make sure it's only the raw paste.");
		}
	},
	minigame: function(message, args, user, rank, room, commandRank, commandRoom){
		let command = toId(args[0]);
		let qbatch = data.batches[command];
		if(!qbatch){
			room.broadcast(user, "There's no query batch with that name.");
		}else if(!AuthManager.rankgeq(commandRank, qbatch.rank)){
			room.broadcast(user, "Your rank is not high enough to use that query batch.");
		}else{
			let queries = qbatch.queries.slice();
			let queryFunc = (queries)=>{
				if(queries.length){
					if(queries[0].substring(0,2) === '--'){
						let parts = queries.shift().substr(2).split(" ")
						if(parts.length === 1){
							delete data.flags[parts[0]]
						}else if(/^\d+$/.test(parts[1])){
							data.flags[parts[0]] = parseInt(parts[1]);
						}else{
							data.flags[parts[0]] = parts[1];
						}
						queryFunc(queries);
					}else{
						pgclient.runSql(queries.shift(), null, null, ()=>{
							queryFunc(queries);
						}, (err)=>{
							error(err);
							room.broadcast(user, "There was an error executing one of the queries.");
						});
					}
				}else{
					room.broadcast(user, qbatch.response || "Successfully executed the queries.");
				}
			}
			queryFunc(queries);
		}
		// if(qbatch){
		// 	if(AuthManager.rankgeq(commandRank, qbatch.rank)){
		// 		let queries = qbatch.queries.slice();
		// 		let queryFunc = (queries)=>{
		// 			if(queries.length){
		// 				if(queries[0].substring(0,2) === '--'){
		// 					let parts = queries.shift().substr(2).split(" ")
		// 					if(parts.length === 1){
		// 						delete data.flags[parts[0]]
		// 					}else if(/^\d+$/.test(parts[1])){
		// 						data.flags[parts[0]] = parseInt(parts[1]);
		// 					}else{
		// 						data.flags[parts[0]] = parts[1];
		// 					}
		// 					queryFunc(queries);
		// 				}else{
		// 					pgclient.runSql(queries.shift(), null, null, ()=>{
		// 						queryFunc(queries);
		// 					}, (err)=>{
		// 						error(err);
		// 						room.broadcast(user, "There was an error executing one of the queries.");
		// 					});
		// 				}
		// 			}else{
		// 				room.broadcast(user, qbatch.response || "Successfully executed the queries.");
		// 			}
		// 		}
		// 		queryFunc(queries);
		// 	}else{
		// 		room.broadcast(user, "Your rank is not high enough to use that query batch.");
		// 	}
		// }else{
		// 	room.broadcast(user, "There's no query batch with that name.");
		// }
	},
	// voice: function(message, args, user, rank, room, commandRank, commandRoom){
	// 	let botRank = AuthManager.getTrueRoomRank(room.getUserData(toId(mainConfig.user)),room);
	// 	if(AuthManager.rankgeq(commandRank, config.voicechatRank) && AuthManager.rankgeq(botRank, "@")){
	// 		if(!data.tempVoices[room.id]) data.tempVoices[room.id] = {};
	// 		for(let i=0;i<args.length;i++){
	// 			let id = toId(args[i]);
	// 			if(!data.tempVoices[room.id][id] && room.getUserData(id) && room.getUserData(id) === " "){
	// 				data.tempVoices[room.id][id] = true;
	// 				room.send("/roomvoice " + id);
	// 			}
	// 		}
	// 		room.send("/modchat +");
	// 	}
	// },
	// devoice: "dv",
	// dv: function(message, args, user, rank, room, commandRank, commandRoom){
	// 	let botRank = AuthManager.getTrueRoomRank(room.getUserData(toId(mainConfig.user)),room);
	// 	if(AuthManager.rankgeq(commandRank, config.voicechatRank) && AuthManager.rankgeq(botRank, "@")){
	// 		for(let i=0;i<args.length;i++){
	// 			let id = toId(args[i]);
	// 			if(data.tempVoices[room.id][id]){
	// 				delete data.tempVoices[room.id][id];
	// 				room.send("/roomdeauth " + id);
	// 			}
	// 		}
	// 	}
	// },
	// devoiceall: "dvall",
	// dvall: function(message, args, user, rank, room, commandRank, commandRoom){
	// 	let botRank = AuthManager.getTrueRoomRank(room.getUserData(toId(mainConfig.user)),room);
	// 	if(AuthManager.rankgeq(commandRank, config.voicechatRank) && AuthManager.rankgeq(botRank, "@")){
	// 		if(data.tempVoices){
	// 			for(let id in data.tempVoices[room.id]){
	// 				delete data.tempVoices[room.id][id];
	// 				room.send("/roomdeauth " + id);
	// 			}
	// 		}
	// 		room.send("/modchat ac");
	// 	}
	// },
	info: "help",
	commands: "help",
	help: function(message, args, user, rank, room, commandRank, commandRoom){
		room.broadcast(user, "This page contains all the commands you need to know: https://github.com/CameronClarry/Showdown-Bot/blob/master/README.md", rank);
	},
	rules: function(message, args, user, rank, room, commandRank, commandRoom){
		room.broadcast(user, "Here's everything you need to know about Trivia Tracker: http://pstrivia.weebly.com/trivia-tracker.html", rank);
	},
	legacyrules: function(message, args, user, rank, room, commandRank, commandRoom){
		room.broadcast(user, "Here are the rules for questions: https://drive.google.com/file/d/0B6H5ZoTTDakRYTBNMzUtWUNndWs/view", rank);
	},
	intro: function(message, args, user, rank, room, commandRank, commandRoom){
		room.broadcast(user, "Here is a beginner's guide to Trivia Tracker (with pictures!): https://pstrivia.weebly.com/trivia-tracker.html#intro", rank);
	},
	plug: function(message, args, user, rank, room, commandRank, commandRoom){
		room.broadcast(user, "https://plug.dj/trivia", rank);
	},
	shuffle: function(message, args, user, rank, room, commandRank, commandRoom){
		room.broadcast(user, shuffle(args).join(", "), rank);
	}
};

self.commands = commands;
exports.commands = commands;

let ttCommands = {
	newgame: function(message, args, user, rank, room, commandRank, commandRoom){
		let targetRoom = args[1] ? RoomManager.getRoom(toRoomId(args[1])) : room;
		if(!targetRoom || !targetRoom.id){
			room.broadcast(user, "You either specified an invalid room, or I am not in that room.");
		}else if(data.games[targetRoom.id]){
			room.broadcast(user, "There is already a game of Trivia Tracker in " + room.name + ".");
		}else if(!AuthManager.rankgeq(commandRank, config.startGameRank)){
			room.broadcast(user, "Your rank is not high enough to start a game of Trivia Tracker");
		}else{
			let targetUser = targetRoom.getUserData(user.id);
			if(targetUser){
				let curHist = {active:targetUser};
				data.games[targetRoom.id] = {room: targetRoom, curUser: targetUser, curHist: curHist, history:[curHist]};
				targetRoom.send("**A new game of Trivia Tracker has started.**");
			}else{
				data.games[targetRoom.id] = {room: room, history:[], bpOpen: "auth"};
				targetRoom.send("**A new game of Trivia Tracker has started. Since " + user.name + " is not in the room for some reason, BP is now open.**");
			}
		}
	},
	endgame: function(message, args, user, rank, room, commandRank, commandRoom){
		let targetRoom = args[1] ? RoomManager.getRoom(toRoomId(args[1])) : room;
		if(!targetRoom || !targetRoom.id){
			room.broadcast(user, "You either specified an invalid room, or I am not in that room.");
		}else if(!data.games[targetRoom.id]){
			room.broadcast(user, "There is no game of Trivia Tracker in " + targetRoom.name + " to end.");
		}else if(!AuthManager.rankgeq(commandRank, config.endGameRank)){
			room.broadcast(user, "Your rank is not high enough to end the game of Trivia Tracker.");
		}else{
			clearTimers(data.games[targetRoom.id]);
			delete data.games[targetRoom.id];
			targetRoom.send("**The game of Trivia Tracker has ended.**");
		}
	}
};

let ttleaderboardCommands = {
	list: function(message, args, user, rank, room, commandRank, commandRoom){
		let lb = args[2] || "main";
		let number = /^[\d]+$/.test(args[1]) ? parseInt(args[1], 10) : 5;
		let rows = [];
		listLeaderboardEntries([number, lb], (row)=>{
			rows.push(row);
		},()=>{
			if(!rows.length){
				room.broadcast(user, "There are no players on the " + lb + " leaderboard.", rank, true);
			}else{
				if(args[3] &&  AuthManager.rankgeq(commandRank, "%")){
					sayScores(rows, lb, room);
				}else{
					room.broadcast(user, "The top " + rows.length + " score" + (rows.length === 1 ? "" : "s") + " in the " + lb + " leaderboard " + (rows.length === 1 ? "is" : "are") + ": " + rows.map((row)=>{return "__" + (row.display_name || row.id1) + "__: " + row.points}).join(", ") + ".", rank, true);
				}
			}
		},(err)=>{
			error(err);
			room.broadcast(user, "There was either an error fetching the scores or the leaderboard you entered does not exist.", rank, true);
		});
	},
	listall: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, "#")) return;
		let lb = toId(args[1]) || "main";
		let rows = [];
		pgclient.runSql(LIST_ALL_LB_ENTRIES_SQL, [lb], (row)=>{
			rows.push(row);
		},()=>{
			if(!rows.length){
				user.send("There are no players on the " + lb + " leaderboard.");
			}else{
				let text = "Listed here all players with a score of at least 1 on the " + lb + " leaderboard.\n";
				text = text + "\n" + rows.map((row)=>{return (row.display_name || row.id1) + ": " + row.points}).join("\n");
				uploadText(text, (link)=>{
					user.send("Here is the full leaderboard: " + link);
				}, (err)=>{
					user.send("There was an error: " + err);
				});
			}
		},(err)=>{
			error(err);
			user.send("There was either an error fetching the scores or the leaderboard you entered does not exist.")
		});
	},
	check: function(message, args, user, rank, room, commandRank, commandRoom){
		let player = args[1] || user.id;
		let boardId = toId(args[2]) || "main";
		let boardName;
		pgclient.runSql(GET_LB_SQL, [boardId], (row)=>{
			boardName = row.display_name;
		}, ()=>{
			if(!boardName){
				room.broadcast(user, "The leaderboard you entered does not exist.", rank, true);
			}else{
				pgclient.getId(player, false, (res)=>{
					if(!res){
						room.broadcast(user, player + " does not have a score on the " + boardName + " leaderboard.", rank, true);
					}else{
						getLeaderboardEntry([res.id, boardId], (entry)=>{
							if(!entry){
								room.broadcast(user, res.display_name + " does not have a score on the " + boardName + " leaderboard.", rank, true);
							}else{
								room.broadcast(user, res.display_name + "'s score on the " + boardName + " leaderboard is " + entry.points + ".", rank, true);
							}
						},(err)=>{
							error(err);
							room.broadcast(user, "There was an error fetching the score for " + res.display_name + ".", rank, true);
						});
					}
				}, (err)=>{
					error(err);
					room.broadcast(user, "There was an error getting " + player + "'s id.", rank, true);
				});
			}
		}, (err)=>{
			error(err);
			room.broadcast(user, "There was an error getting the leaderboard list.", rank, true);
		});


	},
	//Number of people, your place, your score, points to next place
	summary: function(message, args, user, rank, room, commandRank, commandRoom){
		let lb = toId(args[1]) || "main";
		let id = (AuthManager.rankgeq(commandRank, "%") && toId(args[2])) || user.id;
		let lbExists = false;
		let lbname = "";
		pgclient.runSql(GET_ALL_LB_SQL, [], (lbRow)=>{
			if(lbRow.id === lb){
				lbExists = true;
				lbname = lbRow.display_name;
			}
		}, ()=>{
			if(!lbExists){
				room.broadcast(user, "The leaderboard you entered does not exist.", rank);
			}else{
				let res;
				pgclient.getId(id, false, (res)=>{
					if(!res){
						room.broadcast(user, "You do not have a score on the " + lbname + " leaderboard.", rank);
					}else{
						getLeaderboardEntry([res.id, lb], (entry)=>{
							if(!entry){
								room.broadcast(user, "You do not have a score on the " + lbname + " leaderboard.", rank);
							}else{
								let score = entry.points;
								let entries = [];
								pgclient.runSql(GET_ALL_LB_ENTRIES_SQL, [lb], (row)=>{
									entries.push(row)
								}, (res2)=>{
									if(entries.length === 0){
										room.broadcast(user, "There doesn't seem to be anyone on the leaderboard. Maybe something went wrong.", rank);
									}else if(entries.length === 1){
										room.broadcast(user, "You are the only person on the leaderboard (and your score is " + score + ").", rank);
									}else{
										if(entries[0].points === score){
											let nextPlayer = idsMatch(entries[0].display_name, res.display_name) ? entries[1] : entries[0];
											let response = "You are first on the leaderboard with " + score + " points."
											response += "Second place is __" + nextPlayer.display_name + "__ with " + entries[1].points + " points.";
											room.broadcast(user, response, rank);
										}else{
											let higherEntries = entries.filter(item=>{return item.points > score});
											let response = "First place is __" + entries[0].display_name + "__ with " + entries[0].points + " points.";
											response += " Your rank is " + (higherEntries.length+1) + " with " + score + " points.";
											response += " The next player above you is __" + higherEntries[higherEntries.length - 1].display_name + "__ with " + higherEntries[higherEntries.length - 1].points + " points.";
											room.broadcast(user, response, rank);
										}
									}
								}, (err)=>{
									error(err);
									room.broadcast(user, "There was an error while getting the scores.", rank);
								});
							}
						},(err)=>{
							error(err);
							room.broadcast(user, "There was an error fetching the score for " + res.display_name + ".", rank);
						});
					}
				}, (err)=>{
					error(err);
					room.broadcast(user, "There was an error getting " + user + "'s id.", rank);
				});
			}
		}, (err)=>{
			error(err);
			room.broadcast(user, "There was an error getting the leaderboard list.", rank);
		});
	},
	stats: function(message, args, user, rank, room, commandRank, commandRoom){

		let lb = toId(args[1]) || "main";
		let avg, std, num, lbname;

		pgclient.runSql(GET_ALL_LB_SQL, [], (row)=>{
			if(row.id === lb){
				lbname = row.display_name;
			}
		}, ()=>{
			if(!lbname){
				room.broadcast(user, "That leaderboard doesn't exist.", rank);
			}else{
				pgclient.runSql(GET_NUM_PLAYERS, [lb], (row)=>{
					num = parseInt(row.num_players);
				}, ()=>{
					if(num === 0){
						room.broadcast(user, "There are no players on that leaderboard.", rank);
					}else{
						pgclient.runSql(GET_STD_POINTS, [lb], (row)=>{
							std = Math.round(row.std_points*100)/100;
						}, ()=>{
							pgclient.runSql(GET_AVG_POINTS, [lb], (row)=>{
								avg = Math.round(row.avg_points*10)/10;
							}, ()=>{
								room.broadcast(user, "There are " + num + " players on the " + lbname + " leaderboard. The average score is " + avg + " and the standard deviation is " + std + ".", rank);
							}, (err)=>{
								error(err);
								room.broadcast(user, "There was an error getting the leaderboard information.", rank);
							});
						}, (err)=>{
							error(err);
							room.broadcast(user, "There was an error getting the leaderboard information.", rank);
						});
					}
				}, (err)=>{
					error(err);
					room.broadcast(user, "There was an error getting the leaderboard information.", rank);
				});
			}
		}, (err)=>{
			error(err);
			room.broadcast(user, "There was an error getting the leaderboard list.", rank);
		});
	},
	set: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank,config.editScoreRank)){
			room.broadcast(user, "Your rank is not high enough to change someone's score.", rank);
		}else	if(args.length<=2 || !toId(args[1])){
			room.broadcast(user, "You must specify the user's name, and the number of points to add.", rank);
		}else if(!/^[\d]+$/.test(args[2])){
			room.broadcast(user, "Invalid number format for the number of points.", rank);
		}else{
			let player = args[1];
			let points = parseInt(args[2], 10);
			let boardId = toId(args[3]) || "main"
			let boardName;
			pgclient.runSql(GET_LB_SQL, [boardId], (row)=>{
				boardName = row.display_name;
			}, ()=>{
				if(!boardName){
					room.broadcast(user, "That leaderboard doesn't exist.", rank);
				}else{
					updateLeaderboardEntryByUsername([player, boardId], (oldPoints)=>{
						return points;
					}, (res, newPoints)=>{
						if(!res){
							room.broadcast(user, "Created a new " + boardName + " leaderboard entry for " + player + " and set their score to " + newPoints + ".", rank);
						}else{
							room.broadcast(user, "Updated the score for " + res.display_name + ". Their " + boardName + " leaderboard score changed from " + res.points + " to " + newPoints + ".", rank);
						}
					}, (err)=>{
						error(err);
						room.broadcast(user, "There was an error updating the score.", rank);
					});
				}
			}, (err)=>{
				error(err);
				room.broadcast(user, "There was an error getting the leaderboard information.", rank);
			});
		}
	},
	add: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, config.editScoreRank)){
			room.broadcast(user, "Your rank is not high enough to change someone's score.", rank);
		}else if(args.length<=2 || !toId(args[1])){
			room.broadcast(user, "You must specify the user's name, and the number of points to add.", rank);
		}else if(!/^-?[\d]+$/.test(args[2])){
			room.broadcast(user, "Invalid number format for the number of points.", rank);
		}else{
			let target = args[1];
			let points = parseInt(args[2], 10);
			updateAllLeaderboardEntriesByUsername(target, (oldPoints)=>{
				return Math.max(oldPoints + points, 0);
			}, (name, affected, failed)=>{
				let response = "Updated " + affected + " scores for " + name + ".";
				if(failed.length){
					response += " The following leaderboards failed to update: " + failed.join(", ") + ".";
				}
				room.broadcast(user, response, rank);
			}, (err)=>{
				error(err);
				room.broadcast(user, "There was an error updating the scores.", rank);
			});
		}
	},
	addto: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, config.editScoreRank)){
			room.broadcast(user, "Your rank is not high enough to change someone's score.", rank);
		}else if(args.length<4 || !toId(args[1]) || !toId(args[3])){
			room.broadcast(user, "You must specify the user's name, the number of points to add, and the leaderboard.", rank);
		}else if(!/^-?[\d]+$/.test(args[2])){
			room.broadcast(user, "Invalid number format for the number of points.", rank);
		}else{
			let player = args[1];
			let points = parseInt(args[2], 10);
			let boardId = toId(args[3])
			let boardName;
			pgclient.runSql(GET_LB_SQL, [boardId], (row)=>{
				boardName = row.display_name;
			}, ()=>{
				if(!boardName){
					room.broadcast(user, "That leaderboard doesn't exist.", rank);
				}else{
					updateLeaderboardEntryByUsername([player, boardId], (oldPoints)=>{
						return oldPoints + points;
					}, (res, newPoints)=>{
						if(!res){
							room.broadcast(user, "Created a new " + boardName + " leaderboard entry for " + player + " and set their score to " + newPoints + ".", rank);
						}else{
							room.broadcast(user, "Updated the score for " + res.display_name + ". Their " + boardName + " leaderboard score changed from " + res.points + " to " + newPoints + ".", rank);
						}
					}, (err)=>{
						error(err);
						room.broadcast(user, "There was an error updating the score.", rank);
					});
				}
			}, (err)=>{
				error(err);
				room.broadcast(user, "There was an error getting the leaderboard information.", rank);
			})
		}
	},
	remove: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!toId(args[1])){
			room.broadcast(user, "You must specify a user.", rank);
		}else if(!AuthManager.rankgeq(commandRank, config.editScoreRank)){
			room.broadcast(user, "Your rank is not high enough to remove someone's leaderboard entries.", rank);
		}else{
			pgclient.getId(args[1], false, (player)=>{
				if(!player){
					room.broadcast(user, args[1] + " does not have any leaderboard entries.", rank);
				}else{
					removeAllLeaderboardEntries(player.id, (res)=>{
						room.broadcast(user, "Removed " + res.rowCount + " leaderboard entries for " +	args[1] + ".", rank);
					}, ()=>{}, (err)=>{
						error(err);
						room.broadcast(user, "There was an error removing the entries.", rank);
					});
				}
			}, (err)=>{
				error(err);
				room.broadcast(user, "There was an error while getting " + args[1] + "'s id.", rank);
			});
		}
	},
	reset: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, config.resetLeaderboardRank)){
			room.broadcast(user, "Your rank is not high enough to reset the leaderboard.", rank);
		}else{
			if(idsMatch(user.id, data.askToReset)){
				try{
					let child = spawn("pg_dump", [mainConfig.dbname]);
					let parts = [];
					child.stdout.on("data", (data)=>{
						parts.push(data);
					});
					child.on('error', (err)=>{
						error("There was an error with the subprocess.");
						room.broadcast(user, "There was an error with the subprocess responsible for creating the database dump.", rank);
					});
					child.on("exit", (code, signal)=>{
						let text = parts.join("");
						let filename = "backups/" + new Date().toISOString() + ".dump";
						fs.writeFile(filename, text, (err)=>{
							// Now that the database has been written, it's okay to reset
							getAllLeaderboardEntries("main", (arr)=>{
								pgclient.getId(user.id, true, (user)=>{
									pgclient.runSql(DELETE_LB_ENTRIES_SQL, ["main"], null, (res)=>{
										pgclient.runSql(RESET_MAIN_LB_SQL, [user.id], null, ()=>{
											room.broadcast(user, "Successfully deleted " + res.rowCount + " score(s) from the main leaderboard.", rank);
											data.askToReset = "";
											achievementsOnReset("main", arr);
										}, (err)=>{
											error(err);
											room.broadcast(user, "There was an updating the leaderboard info.", rank);
										})
									}, (err)=>{
										error(err);
										room.broadcast(user, "There was an error while removing the leaderboard.", rank);
									});
								}, (err)=>{
									error(err);
									room.broadcast(user, "There was an error while getting your id.", rank);
								});
							});
						});
					});
				}catch(e){
					error(e.message);
					room.broadcast(user, "There was an error creating the subprocess responsible for creating the database dump.", rank);
				}
			}else{
				data.askToReset = user.id;
				room.broadcast(user, "Are you sure you want to reset the leaderboard? (Enter the reset command again to confirm)", rank);
			}
		}
	}
};

let ttleaderboardEventCommands = {
	list: function(message, args, user, rank, room, commandRank, commandRoom){
		let events = [];
		pgclient.runSql(GET_ALL_LB_SQL, [], (row)=>{
			events.push(row);
		}, ()=>{
			if(!events.length){
				room.broadcast(user, "There are no leaderboards right now.", rank);
			}else{
				room.broadcast(user, "These are the current leaderboards: " + events.map((event)=>{return event.display_name}).join(", "), rank);
			}
		}, (err)=>{
			error(err);
			room.broadcast(user, "There was an error fetching the leaderboards.", rank);
		});
	},
	add: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, config.manageEventRank)){
			room.broadcast(user, "Your rank is not high enough to create a leaderboard.", rank);
		}else if(args.length<2 || !toId(args[1])){
			room.broadcast(user, "You must specify the name for the leaderboard.", rank);
		}else if(args[1].length > 20){
			room.broadcast(user, "That name is too long.", rank);
		}else{
			let displayName = args[1];
			let lb;
			pgclient.runSql(GET_LB_SQL, [toId(displayName)], (row)=>{
				lb = row;
			}, ()=>{
				if(lb){
					room.broadcast(user, "A leaderboard already exists with the same name.", rank);
				}else{
					pgclient.getId(user.id, true, (res)=>{
						pgclient.runSql(INSERT_LB_SQL, [toId(displayName), displayName, res.id], null, ()=>{
							room.broadcast(user, "Successfully created a new leaderboard.", rank);
						}, (err)=>{
							error(err);
							room.broadcast(user, "There was an error while creating the new leaderboard.", rank);
						});
					}, (err)=>{
						error(err);
						room.broadcast(user, "There was a problem getting your id.", rank);
					});
				}
			}, (err)=>{
				error(err);
				room.broadcast(user, "Something went wrong when trying to fetch the leaderboard list.", rank);
			});
		}
	},
	remove: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, config.manageEventRank)){
			room.broadcast(user, "Your rank is not high enough to remove a leaderboard.", rank);
		}else if(args.length<2 || !toId(args[1])){
			room.broadcast(user, "You must specify the name for the leaderboard.", rank);
		}else if(toId(args[1]) === "main"){
			room.broadcast(user, "You cannot remove that leaderboard.", rank);
		}else{
			let id = toId(args[1]);
			let lb;
			pgclient.runSql(GET_LB_SQL, [id], (row)=>{
				lb = row;
			}, ()=>{
				if(!lb){
					room.broadcast(user, "There is no leaderboard with that name.", rank);
				}else{
					pgclient.runSql(DELETE_LB_ENTRIES_SQL, [id], null, (res)=>{
						pgclient.runSql(DELETE_LB_SQL, [id], null, ()=>{
							room.broadcast(user, "Successfully removed the leaderboard and deleted " + res.rowCount + " score(s).", rank);
						}, (err)=>{
							error(err);
							room.broadcast(user, "There was an error while removing the leaderboard.", rank);
						});
					}, (err)=>{
						error(err);
						room.broadcast(user, "There was an error while removing the leaderboard.", rank);
					});
				}
			}, (err)=>{
				error(err);
				room.broadcast(user, "Something went wrong when trying to fetch the leaderboard list.", rank);
			});
		}
	},
	info: function(message, args, user, rank, room, commandRank, commandRoom){
		let lbName = args[1] || "main";
		let id = toId(lbName);
		let lb;
		pgclient.runSql(GET_LB_SQL, [id], (row)=>{
			lb = row;
		}, ()=>{
			if(!lb){
				room.broadcast(user, "There is no leaderboard with the name " + lbName + ".", rank);
			}else if(id !== "main"){
				room.broadcast(user, "Leaderboard name: " + lb.display_name + ", created on: " + lb.created_on.toUTCString() + ", created by: " + lb.created_by + ", enabled: " + lb.enabled, rank);
			}else{
				room.broadcast(user, "Leaderboard name: " + lb.display_name + ", last reset: " + lb.created_on.toUTCString() + ", reset by: " + lb.created_by + ", enabled: " + lb.enabled, rank);
			}
		}, (err)=>{
			error(err);
			room.broadcast(user, "Something went wrong when trying to fetch the leaderboard.", rank);
		});
	},
	enable: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, config.manageEventRank)){
			room.broadcast(user, "Your rank is not high enough to enable a leaderboard.", rank);
		}else if(args.length<2){
			room.broadcast(user, "You must specify the name for the leaderboard.", rank);
		}else{
			let id = toId(args[1]);
			let lb;
			pgclient.runSql(GET_LB_SQL, [id], (row)=>{
				lb = row;
			}, (res)=>{
				if(!lb){
					room.broadcast(user, "The leaderboard you specified doesn't exist.", rank);
				}else if(lb.enabled){
					room.broadcast(user, "That leaderboard is already enabled.", rank);
				}else{
					pgclient.runSql(UPDATE_LB_SQL, [id, true], null, (res)=>{
						room.broadcast(user, "Successfully enabled the " + lb.display_name + " leaderboard.", rank);
					}, (err)=>{
						error(err);
						room.broadcast(user, "There was an error while updating the leaderboard.", rank);
					})
				}
			}, (err)=>{
				error(err);
				room.broadcast(user, "There was an error when retrieving the leaderboards.", rank);
			});
		}
	},
	disable: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, config.manageEventRank)){
			room.broadcast(user, "Your rank is not high enough to disable a leaderboard.", rank);
		}else if(args.length<2){
			room.broadcast(user, "You must specify the name for the leaderboard.", rank);
		}else{
			let id = toId(args[1]);
			let lb;
			pgclient.runSql(GET_LB_SQL, [id], (row)=>{
				lb = row;
			}, (res)=>{
				if(!lb){
					room.broadcast(user, "The leaderboard you specified doesn't exist.", rank);
				}else if(!lb.enabled){
					room.broadcast(user, "That leaderboard is already disabled.", rank);
				}else{
					pgclient.runSql(UPDATE_LB_SQL, [id, false], null, (res)=>{
						room.broadcast(user, "Successfully disabled the " + lb.display_name + " leaderboard.", rank);
					}, (err)=>{
						error(err);
						room.broadcast(user, "There was an error while updating the leaderboard.", rank);
					})
				}
			}, (err)=>{
				error(err);
				room.broadcast(user, "There was an error when retrieving the leaderboards.", rank);
			});
		}
	}
};

let blacklistCommands = {
	add: function(username, id, duration, reason, user, room, triviaRoom){
		let entry = getBlacklistEntry(id);
		if(entry){
			room.broadcast(user, "The user " + entry.displayName + " is already on the blacklist.");
		}else if(duration){
			data.leaderboard.blacklist[id] = {displayName: username, reason: reason, duration: duration*60000, time: Date.now()};
			room.broadcast(user, "Added " + username + " to the blacklist for " + millisToTime(duration*60000) + ".");
			triviaRoom.send("/modnote " + username + " was added to the Trivia Tracker blacklist by " + user.name + " for " + millisToTime(duration*60000) + ". (" + reason + ")");
		}else{
			data.leaderboard.blacklist[id] = {displayName: username, reason: reason, duration: duration*60000, time: Date.now()};
			room.broadcast(user, "Added " + username + " to the blacklist permanently.");
			triviaRoom.send("/modnote " + username + " was added to the Trivia Tracker blacklist permanently by " + user.name + ". (" + reason + ")");
		}
		saveLeaderboard();
	},
	remove: function(username, id, duration, reason, user, room, triviaRoom){
		let entry = getBlacklistEntry(id);
		if(!entry){
			room.broadcast(user, "The user " + username + " is not on the blacklist.");
		}else{
			delete data.leaderboard.blacklist[id];
			room.broadcast(user, "Removed " + entry.displayName + " from the blacklist.");
			triviaRoom.send("/modnote " + entry.displayName + " was removed from the Trivia Tracker blacklist by " + user.name);
			saveLeaderboard();
		}
	},
	check: function(username, id, duration, reason, user, room, triviaRoom){
		let entry = getBlacklistEntry(id);
		if(entry && !entry.duration){
			room.broadcast(user, "The user " + entry.displayName + " is permantently on the blacklist. Reason: " + entry.reason + ".");
		}else if(entry){
			room.broadcast(user, "The user " + entry.displayName + " is on the blacklist for " + millisToTime(entry.duration - Date.now() + entry.time) + ". Reason: " + entry.reason + ".");
		}else{
			room.broadcast(user, "The user " + username + " is not on the blacklist.");
		}
	},
	unmute:function(username, id, duration, reason, user, room, triviaRoom){
		let entry = getBlacklistEntry(id);
		if(!entry){
			room.broadcast(user, "The user " + username + " is not on the blacklist.");
		}else if(!entry.duration || entry.duration > 60*60000){
			room.broadcast(user, "That user is blacklisted for longer than a mute.");
		}else{
			delete data.leaderboard.blacklist[id];
			room.broadcast(user, "Removed " + entry.displayName + " from the blacklist.");
			triviaRoom.send("/modnote " + entry.displayName + " was removed from the Trivia Tracker blacklist by " + user.name);
			saveLeaderboard();
		}
	}
};

let tryBatonPass = function(game, user, nextPlayer, historyToAdd, shouldUndoAsker, shouldUndoAnswerer, remindTime, bypassBl){
	remindTime = remindTime || config.remindTime;
	let blEntry = getBlacklistEntry(nextPlayer.id);
	if(game.curUser.id === nextPlayer.id){
		game.room.broadcast(user, "It is already " + nextPlayer.name + "'s turn to ask a question.");
	}else if(blEntry && !bypassBl){
		game.room.send(nextPlayer.name + " is on the blacklist. BP is now open.");
		game.bpOpen = "auth";
		clearTimers(game);
	}else if(nextPlayer.trueRank === "‽" || nextPlayer.trueRank === "!"){
		game.room.broadcast(user, nextPlayer.name + " is either muted or locked.");
	}else{
		if(shouldUndoAsker && game.curHist.undoAsker){
			game.curHist.undoAsker();
			game.curHist.undoAsker = null;
		}
		if(shouldUndoAnswerer && game.curHist.undoAnswerer){
			game.curHist.undoAnswerer();
			game.curHist.undoAnswerer = null;
		}
		let response = "**It is now " + nextPlayer.name + "'s turn to ask a question.**";
		if(blEntry){
			response = response + " " + nextPlayer.name + " is on the TT blacklist.";
		}
		game.history.add(historyToAdd);
		game.curHist = historyToAdd;
		game.curUser = nextPlayer;
		if(game.history.length>10) game.history.shift();
		game.bpOpen = null;
		clearTimers(game);
		game.remindTimer = setTimeout(()=>{
			onRemind(game);
		}, remindTime*1000);
		game.room.send(response);
		return true;
	}
	return false;
}

let sayScores = function(scores, lb, room){
	let message = "/addhtmlbox <table style=\"background-color: #45cc51; margin: 2px 0;border: 2px solid #0d4916;color: black\" border=1><tr style=\"background-color: #209331\"><th colspan=\"2\">" + lb + "</th></tr><tr style=\"background-color: #209331\"><th style=\"width: 150px\">User</th><th>Score</th></tr>";
	for(let i=0;i<scores.length;i++){
		message = message + "<tr><td>" + (scores[i].display_name || scores[i].id1) + "</td><td>" + scores[i].points + "</td></tr>";
	}
	message = message + "</table>"

	room.send(message);
}

let onRemind = function(game){
	if(game.curUser){
		if(!game.bpOpen && !game.bpLocked){ // don't remind people to ask questions if BP is locked, since they can't ask.
			game.curUser.send("You have " + (config.openTime) + " seconds to ask a question.");
		}
		let rank = AuthManager.getRank(game.curUser, game.room);
		if(!AuthManager.rankgeq(rank, config.manageBpRank)){
			game.openTimer = setTimeout(()=>{
				onTimeUp(game);
			},config.openTime*1000);
		}
	}
};

let onTimeUp = function(game){
	if(!game.bpOpen && !game.bpLocked){
		game.room.send("**BP is now open (say 'me' or 'bp' to claim it).**");
		game.bpOpen = "timer";
	}else if( (game.bpOpen == "leave" || game.bpOpen == "user") && !game.bpLocked ){
		game.bpOpen = "timer";
	}
	clearTimers(game);
}

let clearTimers = function(game, clearAll){
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
	if(game.blitzTimer && clearAll){
		clearTimeout(game.blitzTimer);
		game.blitzTimer = null;
	}
}

let getBlacklistEntry = function(username){
	let leaderboard = data.leaderboard;
	let entry = leaderboard.blacklist[username];
	if(entry && entry.duration){
		if(Date.now() - entry.time > entry.duration){
			delete leaderboard.blacklist[username];
			saveLeaderboard();
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
	let path = "data/leaderboard.json";
	//let file = fs.openSync(path,'w');
	fs.writeFile(path,JSON.stringify(data.leaderboard, null, "\t"), function(){
		//fs.closeSync(file);
	});
};

let loadLeaderboard = function(){
	let path = "data/leaderboard.json";
	if(fs.existsSync(path)){
		let leaderboard = JSON.parse(fs.readFileSync(path, 'utf8'));
		if(!leaderboard.blacklist){
			leaderboard.blacklist = {};
		}
		data.leaderboard = leaderboard;
		saveLeaderboard();
	}else{
		data.leaderboard = {blacklist:{}};
		saveLeaderboard();
	}
};

let saveFacts = function(){
	try{
		let filename = "data/facts.json";
		let factsFile = fs.openSync(filename,"w");
		fs.writeSync(factsFile,JSON.stringify(data.facts, null, "\t"));
		fs.closeSync(factsFile);
	}catch(e){
		error(e.message);
	}
}

let loadFacts = function(){
	let result = "Could not load the facts.";
	try{
		let filename = "data/facts.json";
		if(fs.existsSync(filename)){
			data.facts = JSON.parse(fs.readFileSync(filename, "utf8"));
			result = "Found and loaded the facts.";
		}else{
			data.facts = [];
			let factsFile = fs.openSync(filename,"w");
			fs.writeSync(factsFile,JSON.stringify(data.facts, null, "\t"));
			fs.closeSync(factsFile);
			result = "Could not find the facts file, made a new one.";
		}
	}catch(e){
		error(e.message);
	}
};

let saveBatches = function(){
	try{
		let filename = "data/batches.json";
		let batchFile = fs.openSync(filename,"w");
		fs.writeSync(batchFile,JSON.stringify(data.batches, null, "\t"));
		fs.closeSync(batchFile);
	}catch(e){
		error(e.message);
	}
}

let loadBatches = function(){
	let result = "Could not load the query batches.";
	try{
		let filename = "data/batches.json";
		if(fs.existsSync(filename)){
			data.batches = JSON.parse(fs.readFileSync(filename, "utf8"));
			result = "Found and loaded the facts.";
		}else{
			data.batches = [];
			let batchFile = fs.openSync(filename,"w");
			fs.writeSync(batchFile,JSON.stringify(data.batches, null, "\t"));
			fs.closeSync(batchFile);
			result = "Could not find the query batch file, made a new one.";
		}
	}catch(e){
		error(e.message);
	}
};

// Achievement crap
// This is called when a leaderboard is reset.
// leaderboard is the string id of the leaderboard being reset.
// scores is an array of {display_name, points}, sorted descending by points.
// There are achievements for getting first, getting top 5, and getting 6th
let achievementsOnReset = function(leaderboard, scores){
	if(scores.length > 0 && leaderboard === "main" && achievements){ // Awarding achievements
		let firstPlace = scores.filter((e)=>{return e.points === scores[0].points});
		for(let i=0;i<firstPlace.length;i++){
			achievements.awardAchievement(firstPlace[i].display_name, "Hatmor", (p,a)=>{});
		}
		let num = firstPlace.length;
		while(num<5 && num < scores.length){ // Using black magic to find all players in the top 5
			num += scores.filter((e)=>{return e.points === scores[num].points}).length;
		}
		let top5 = scores.slice(firstPlace.length, num);
		for(let i=0;i<top5.length;i++){
			achievements.awardAchievement(top5[i].display_name, "Elite", (p,a)=>{});
		}
		let message = "Congratulations to " + prettyList(firstPlace.map((e)=>{return e.display_name})) + " for getting first";
		if(top5.length){
			message += ", and to " + prettyList(top5.map((e)=>{return e.display_name})) + " for being in the top five!";
		}else{
			message += "!"
		}
		let triviaRoom = RoomManager.getRoom(GOVERNING_ROOM);
		if(!triviaRoom) return;
		triviaRoom.send(message);
		if(num === 5 && scores.length > 5){
			let consolation = scores.filter((e)=>{return e.points === scores[5].points});
			for(let i=0;i<consolation.length;i++){
				achievements.awardAchievement(consolation[i].display_name, "Consolation Prize", (p,a)=>{
					triviaRoom.send(p + " has earned the achievement '" + a + "'!");
				});
			}
		}
	}
}

let achievementsOnScoreUpdate = function(user, leaderboard, oldScore, newScore){
	let triviaRoom = RoomManager.getRoom(GOVERNING_ROOM);
	if(leaderboard === "main" && achievements){
		if(oldScore<250 && newScore >= 250){
			achievements.awardAchievement(user, "Super", (p,a)=>{
				if(triviaRoom) triviaRoom.send(p + " has earned the achievement '" + a + "'!");
			});
		}
		if(oldScore<500 && newScore >= 500){
			achievements.awardAchievement(user, "Mega", (p,a)=>{
				if(triviaRoom) triviaRoom.send(p + " has earned the achievement '" + a + "'!");
			});
		}
		if(oldScore<750 && newScore >= 750){
			achievements.awardAchievement(user, "Ultra", (p,a)=>{
				if(triviaRoom) triviaRoom.send(p + " has earned the achievement '" + a + "'!");
			});
		}
		if(oldScore<1000 && newScore >= 1000){
			achievements.awardAchievement(user, "Hyper", (p,a)=>{
				if(triviaRoom) triviaRoom.send(p + " has earned the achievement '" + a + "'!");
			});
		}
	}
}

let removeFormatting = function(text){
	let reg = /([_~*`^])\1(.+)\1\1/g;
	while(reg.test(text)){
		text = text.replace(reg, "$2");
	}
	reg = /\[\[(.+)\]\]/g;
	while(reg.test(text)){
		text = text.replace(reg, "$1");
	}
	return text;
}

let defaultConfigs = {
	timerRank: "%",
	factRank: "+",
	batchRank: "#",
	startGameRank: "+",
	endGameRank: "%",
	manageBpRank: "+",
	manageBlRank: "@",
	editScoreRank: "@",
	resetLeaderboardRank: "#",
	manageEventRank: "@",
	voicechatRank: "@",
	remindTime: 240,
	openTime: 60,
	leaveGraceTime: 20,
	answerPoints: 1,
	askPoints: 1
};

exports.defaultConfigs = defaultConfigs;

let configTypes = {
	timerRank: "rank",
	factRank: "rank",
	batchRank: "rank",
	startGameRank: "rank",
	endGameRank: "rank",
	manageBpRank: "rank",
	manageBlRank: "rank",
	editScoreRank: "rank",
	resetLeaderboardRank: "rank",
	manageEventRank: "rank",
	voicechatRank: "rank",
	remindTime: "int",
	openTime: "int",
	leaveGraceTime: "int",
	answerPoints: "int",
	askPoints: "int"
};

exports.configTypes = configTypes;
