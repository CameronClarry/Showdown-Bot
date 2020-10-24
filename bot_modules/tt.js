let fs = require("fs");
let path = "./minigames";
delete require.cache[require.resolve(path)];
let minigames = require("./minigames");
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

const GET_STATS = "SELECT AVG(points)::FLOAT avg_points, STDDEV_POP(points)::FLOAT std_points, COUNT(*)::INTEGER num_players FROM tt_points WHERE points > 0 AND leaderboard = $1;";

// Achievement queries, for merging achievements
const GET_PLAYER_ACH_SQL = "SELECT achievement_list.name, player_achievements.achievement_id, player_achievements.date_achieved from player_achievements INNER JOIN achievement_list ON player_achievements.achievement_id = achievement_list.id WHERE player_achievements.player_id = $1;";
const UPDATE_ACH_ID_SQL = "UPDATE player_achievements SET player_id = $1 WHERE player_achievements.player_id = $2 AND player_achievements.achievement_id = $3;";
const UPDATE_ACH_DATE_SQL = "UPDATE player_achievements SET date_achieved = $1 WHERE player_id = $2 AND achievement_id = $3;";
const REMOVE_PLAYER_ACH_SQL = "DELETE FROM player_achievements WHERE player_id = $1;";

// TODO when getting a single score, outer join it with the leaderbaord table to know if the leaderboard exists 
// TODO one function for updating sores: 'all' vs 'enabled' vs ['lb1', 'lb2', ...]. make updatefunc take the lb id as well

//args is [dbId, leaderboard]
let getLeaderboardEntry = function(args, callback){
	pgclient.runSql(GET_LB_ENTRY_SQL, [args[0], toId(args[1])], (err, res)=>{
		if(err){
			callback(err);
			return;
		}

		callback(err, res.rows[0]);
	});
};

//args is [number of entries to get, leaderboard]
let listLeaderboardEntries = function(args, callback){
	pgclient.runSql(LIST_LB_ENTRIES_SQL.replace("_NUMBER_",args[0]), [toId(args[1])], callback);
};

let getAllLeaderboardEntries = function(leaderboard, callback){
	pgclient.runSql(GET_ALL_LB_ENTRIES_SQL, [toId(leaderboard)], (err, res)=>{
		if(err){
			callback(err);
			return;
		}

		callback(err, res.rows);
	});
};

//updateFunc takes the old score, and returns what the new score should be
//callback takes err, the old row, and new score, and does whatever
//args is [dbId, leaderboard, display name]
let updateLeaderboardEntryById = function(args, updateFunc, callback){
	getLeaderboardEntry(args, (err, res)=>{
		if(err){
			callback(err);
			return;
		}

		let oldPoints = res ? res.points : 0;
		let newPoints = updateFunc(oldPoints);
		let newCallback = (err, res2)=>{
			if(err){
				callback(err);
				return;
			}

			callback(err, res, newPoints);
			achievementsOnScoreUpdate(args[2], args[1], oldPoints, newPoints, logIfError);
		};

		if(!res){
			pgclient.runSql(INSERT_LB_ENTRY_SQL, [args[0], args[1], newPoints], newCallback);
		}else{
			pgclient.runSql(UPDATE_LB_ENTRY_SQL, [args[0], args[1], newPoints], newCallback);
		}
	});
};

let updateLeaderboardEntryByUsername = function(args, updateFunc, callback){
	pgclient.getUser(args[0], true, (err, res)=>{
		if(err){
			callback(err);
			return;
		}

		updateLeaderboardEntryById([res.id, args[1], res.display_name], updateFunc, callback);
	});
};

let checkPendingUpdates = function(shouldStart){
	if(data.pendingUpdates.length === 1 || shouldStart && data.pendingUpdates.length > 0){
		let entry = data.pendingUpdates[0];
		updateAllLeaderboardEntriesById(entry.id, entry.username, entry.updateFunc, entry.callback);
	}
};

//updateFunc takes the old score, and returns what the new score should be
//callback takes err, the user id, rows updated, array of events failed
let updateAllLeaderboardEntriesById = function(id, username, updateFunc, callback){
	pgclient.runSql(GET_ENABLED_LB_SQL, [], (err, res)=>{
		if(err){
			callback(err);
			return;
		}

		let leaderboards = res.rows.map((row)=>{return row.id;});

		pgclient.runSql(GET_LB_ENTRIES_SQL, [id], (err, res2)=>{
			if(err){
				callback(err);
				return;
			}

			let entries = {};
			for(let i=0;i<res2.rows.length;i++){
				entries[res2.rows[i].leaderboard] = res2.rows[i];
			}
			let	pendingEvents = leaderboards.length;
			let failed = [];
			let totalError = null;

			let sharedCallbackCreator = (leaderboard)=>{
				return (err, res)=>{
					totalError = err || totalError;
					pendingEvents--;
					if(err) failed.push(leaderboard);
					if(pendingEvents === 0){
						callback(totalError, username, leaderboards.length - failed.length, failed);
						data.pendingUpdates.shift();
						checkPendingUpdates(true);
					}
				}
			}
			if(leaderboards.length === 0) callback(err, id, 0, 0);
		});
	});
}

let updateAllLeaderboardEntriesByUsername = function(username, updateFunc, callback){
	pgclient.getUser(username, true, (err, res)=>{
		if(err){
			callback(err);
			return;
		}

		data.pendingUpdates.add({
			id: res.id,
			username: res.display_name,
			updateFunc: updateFunc,
			callback: callback
		});
		checkPendingUpdates();
		// updateAllLeaderboardEntriesById(res.id, res.display_name, updateFunc, (id, affected, failed)=>{
		// 	if(onEnd) onEnd(res.display_name, affected, failed);
		// }, onError);
	});
}

//args is [id, leaderboard]
// TODO is this needed?
let removeLeaderboardEntry = function(args, callback){
	pgclient.runSql(DELETE_LB_ENTRY_SQL, [args[0], toId(args[1])], ()=>{
		if(err){
			callback(err);
			return;
		}

		callback(err, res.rowCount);
	});
};

let removeAllLeaderboardEntries = function(dbId, callback, client){
	pgclient.runSql(DELETE_USER_ENTRIES_SQL, [dbId], callback, client);
}

let removeUserAch = function(dbId, callback, client){
	pgclient.runSql(REMOVE_PLAYER_ACH_SQL, [dbId], callback, client)
}

let transferAllAchievements = function(fromDbId, toDbId, callback, client){
	pgclient.runSql(GET_PLAYER_ACH_SQL, [fromDbId], (err, res)=>{
		if(err){
			callback(err);
			return;
		}

		let entriesToTransfer = res.rows.length;
		let fromEntries = {};
		for(let i=0;i<res.rows.length;i++){
			fromEntries[res.rows[i].achievement_id] = res.rows[i];
		}
		
		if(entriesToTransfer === 0){
			callback();
		}

		pgclient.runSql(GET_PLAYER_ACH_SQL, [toDbId], (err, res2)=>{
			if(err){
				callback(err);
				return;
			}

			let toEntries = {};
			for(let i=0;i<res2.rows.length;i++){
				toEntries[res2.rows[i].achievement_id] = res2.rows[i];
			}

			let totalError = null;
			let sharedCallback = (err, res3)=>{
				totalError = err || totalError;
				entriesToTransfer--;
				// This line should call func to remove all ach entries for fromid
				//if(entriesToTransfer === 0) callback(err);
				if(entriesToTransfer === 0) removeUserAch(fromDbId, callback, client);
			}

			for(let event in fromEntries){
				if(toEntries[event]){
					// Conflicting achievements, compare and update the date
					let d1 = fromEntries[event].date_achieved
					let d2 = toEntries[event].date_achieved
					let newDate = d1 < d2 ? d1 : d2;
					pgclient.runSql(UPDATE_ACH_DATE_SQL, [newDate, toDbId, event], sharedCallback, client);
				}else{
					// No conflict, update the id
					pgclient.runSql(UPDATE_ACH_ID_SQL, [toDbId, fromDbId, event], sharedCallback, client);
				}
			}
		}, client);
	}, client);
}

let transferAllPoints = function(fromDbId, toDbId, callback, client){
	pgclient.runSql(GET_LB_ENTRIES_SQL, [fromDbId], (err, res)=>{
		if(err){
			callback(err);
			return;
		}

		let entriesToTransfer = res.rows.length;
		let fromEntries = {};
		for(let i=0;i<res.rows.length;i++){
			fromEntries[res.rows[i].leaderboard] = res.rows[i];
		}
		
		if(entriesToTransfer === 0){
			callback();
		}

		pgclient.runSql(GET_LB_ENTRIES_SQL, [toDbId], (err, res2)=>{
			if(err){
				callback(err);
				return;
			}

			let toEntries = {};
			for(let i=0;i<res2.rows.length;i++){
				toEntries[res2.rows[i].leaderboard] = res2.rows[i];
			}

			let totalError = null;
			let sharedCallback = (err, res3)=>{
				totalError = err || totalError;
				entriesToTransfer--;
				if(entriesToTransfer === 0) callback(err);
			}

			removeAllLeaderboardEntries(fromDbId, logIfError, client);
			for(let event in fromEntries){
				if(toEntries[event]){
					pgclient.runSql(UPDATE_LB_ENTRY_SQL, [toDbId, event, toEntries[event].points + fromEntries[event].points], sharedCallback, client);
				}else{
					pgclient.runSql(INSERT_LB_ENTRY_SQL, [toDbId, event, fromEntries[event].points], sharedCallback, client);
				}
			}
		}, client);
	}, client);
};

let changeMains = function(id, newName, callback){
	pgclient.runSql(UPDATE_USER_SQL, [id, newName, toId(newName)], callback);
}

// Merges two alts, and their points and achievements
let mergeAlts = function(fromName, toName, callback, client){
	pgclient.getMains(fromName, toName, true, (err, res)=>{
		if(err){
			callback(err);
			return;
		}else if(!res[0] || !res[1]){
			callback("One or more of those accounts does not exist.");
			return;
		}else if(res[0].id === res[1].id){
			callback("Those two accounts are the same.");
			return;
		}

		transferAllPoints(res[0].id, res[1].id, (err)=>{
			if(err){
				callback(err);
				return;
			}

			transferAllAchievements(res[0].id, res[1].id, (err)=>{
				if(err){
					client.end();
					done();
					callback(err);
					return;
				}

				pgclient.runSql(UPDATE_MAINS_SQL, [res[0].id, res[1].id], (err, res2)=>{
					if(err){
						callback(err);
						return;
					}

					pgclient.runSql(DELETE_USER_SQL, [res[0].id], (err, res3)=>{
						if(err){
							callback(err);
							return;
						}

						callback();
					}, client);
				}, client);
			}, client);
		}, client);
	}, client);
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
			flags: {},
			pendingUpdates: [],
			blacklistManager: new BlacklistManager()
		};
		loadFacts();
		loadBatches();
		loadLeaderboard();
		data.blacklistManager.load()
	}
	self.chathooks = {
		chathook: function(room, user, message){
			let game = data.games[room.id];
			if(!game) return;
			let triviaRank = AuthManager.getRank(user, RoomManager.getRoom('trivia'));

			game.onRoomMessage(user, triviaRank, message);
		}
	};
};

exports.onUnload = function(){
	for(let roomid in data.games){
		data.games[roomid].end();
	}
};
let refreshDependencies = function(){
	pgclient = getModuleForDependency("pgclient", "tt");
	achievements = getModuleForDependency("achievements", "tt");
	minigames.refreshDependencies();
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
	if(game) game.onJoin(user);
}
self.processJoin = processJoin;
exports.processJoin = processJoin;

let processLeave = function(room, user){
	let game = data.games[room.id];
	if(game){
		game.onLeave(user);
	}
}
self.processLeave = processLeave;
exports.processLeave = processLeave;

let processName = function(room, user){
	let game = data.games[room.id];
	if(game){
		if(user.trueRank === '‽'){
			game.onPunishment(user, 'lock');
		}else if(user.trueRank === '!'){
			game.onPunishment(user, 'mute');
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
	bet: "yes", // Prize for Zimmy D
	yessir: "yes", // Prize for Sandile1234
	yes: function(message, args, user, rank, room, commandRank, commandRoom){
		let hasRank = AuthManager.rankgeq(commandRank, config.manageBpRank)
		let shouldUndo = hasRank && toId(args[1]) === "afk";
		let roomId = !shouldUndo && hasRank && args[1] ? toRoomId(args[1]) : room.id;
		let game = data.games[roomId];
		if(!game){
			room.broadcast(user, "There is no trivia game in " + roomId + ".");
		}else if(!toId(args[0])){
			room.broadcast(user, "You must specify a player.");
		}else{
			let nextPlayer = game.room.getUserData(toId(args[0]));
			let reason = game.cantYes(user, rank, toId(args[0]));
			if(reason){
				game.room.broadcast(user, reason);
				return;
			}

			game.doYes(user, nextPlayer);
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
		}else{
			let reason = game.cantNo(user, rank, number);
			if(reason){
				room.broadcast(user, reason);
				return;
			}

			game.doNo(user, number);
		}
	},
	bp: function(message, args, user, rank, room, commandRank, commandRoom){
		let roomId = toRoomId(args[1]) || "trivia";
		let game = data.games[roomId];
		if(!game){
			room.broadcast(user, "There is no trivia game in " + roomId + ".");
		}else{
			let id = toId(args[0]);
			if(!id || !AuthManager.rankgeq(commandRank, config.manageBpRank)){
				// TODO can this be moved to the minigame side?
				let curUser = game.curHist.active;
				// if BP is open or locked, there's no need to HL the user who last had it.
				let curName = game.bpOpen || game.bpLock ? "__" + curUser.name + "__" : curUser.name;
				let openLockMessage = game.bpLock ? " (BP is locked)." : (game.bpOpen ? " (BP is open)." : ".");
				room.broadcast(user, curName + " has BP" + openLockMessage);
			}else{
				let nextUser = game.room.getUserData(id);
				let reason = game.cantBp(user, rank, id);
				if(reason){
					room.broadcast(user, reason);
					return;
				}

				game.doBp(user, id);

			}
		}
	},
	lockbp: "bplock",
	bplock: function(message, args, user, rank, room, commandRank, commandRoom){
		let roomId = room && room.id ? room.id : toRoomId(args[0]);
		let game = data.games[roomId];
		if(!roomId){
			user.send("You must specify a room.");
		}else if(!game){
			room.broadcast(user, "There is no game in " + roomId + ".");
		}else{
			let reason = game.cantLockBp(user, rank);
			if(reason){
				room.broadcast(user, reason);
				return;
			}

			game.doBpLock(true);
		}
	},
	unlockbp: "bpunlock",
	bpunlock: function(message, args, user, rank, room, commandRank, commandRoom){
		let roomId = room && room.id ? room.id : toRoomId(args[0]);
		let game = data.games[roomId];
		if(!roomId){
			user.send("You must specify a room.");
		}else if(!game){
			room.broadcast(user, "There is no game in " + roomId + ".");
		}else{
			let reason = game.cantUnlockBp(user, rank);
			if(reason){
				room.broadcast(user, reason);
				return;
			}

			game.doBpUnlock(true);
		}
	},
	openbp: "bpopen",
	bpopen: function(message, args, user, rank, room, commandRank, commandRoom){
		let roomId = room && room.id ? room.id : toRoomId(args[0]);
		let game = data.games[roomId];
		if(!roomId){
			user.send("You must specify a room.");
		}else if(!game){
			room.broadcast(user, "There is no game in " + roomId + ".");
		}else{
			let type = AuthManager.rankgeq(rank, '+') ? 'auth' : 'user';
			let reason = game.cantOpenBp(user, rank, type);
			if(reason){
				room.broadcast(user, reason);
				return;
			}

			game.doOpenBp(type, true);
		}
	},
	closebp: "bpclose",
	bpclose: function(message, args, user, rank, room, commandRank, commandRoom){
		let roomId = room && room.id ? room.id : toRoomId(args[0]);
		let game = data.games[roomId];
		if(!roomId){
			user.send("You must specify a room.");
		}else if(!game){
			room.broadcast(user, "There is not game in " + roomId + ".");
		}else{
			let reason = game.cantCloseBp(user, rank);
			if(reason){
				room.broadcast(user, reason);
				return;
			}

			game.doCloseBp(true, AuthManager.rankgeq(rank, '+'));
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
		pgclient.getMains(user.id, target, false, (err, res)=>{
			if(err){
				error(err);
				room.broadcast(user, "Error " + err);
				return;
			}

			if(!AuthManager.rankgeq(commandRank, "%") && (!res[0] || !res[1] || (res[0].id !== res[1].id))){
				room.broadcast(user, "Your rank is not high enough to check other users' alts.")
			}else if(!res[1]){
				room.broadcast(user, target + " does not have any alts.");
			}else{
				pgclient.runSql(GET_ALTS_SQL, [res[1].id], (err, res2)=>{
					if(err){
						error(err);
						room.broadcast(user, "Error " + err);
					}

					let alts = res2.rows.map((row)=>{return row.username});
					if(alts.length === 0){
						room.broadcast(user, target + " does not have any alts");
					}else if(alts.length < 11){
						room.broadcast(user, res[1].display_name + "'s alts: " + alts.join(", "));
					}else{
						let text = res[1].display_name + "'s alts:\n\n" + alts.join("\n");
						uploadText(text, (address)=>{
							user.send("There were more than 10 alts, so they were put into a text file: " + address);
						}, (error)=>{
							user.send("There was an error while saving the file. Here are the first 6 alts of " + alts.length + ": " + alts.slice(0,6).join(", "));
						});
					}
				});
			}
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
				pgclient.checkout((err, client, done)=>{
					if(err){
						client.end();
						done();
						callback(err);
						return;
					}

					mergeAlts(altuser, userId, (err)=>{
						client.end();
						done();
						if(err){
							error(err);
							room.broadcast(user, "Error: " + err);
							return;
						}

						pendingAlts[altuser].splice(pendingAlts[altuser].indexOf(userId),1);
						if(pendingAlts[altuser].length === 0){
							delete pendingAlts[altuser];
						}
						room.broadcast(user, "Successfully linked accounts.");
					}, client);
				});
			}else{
				if(!pendingAlts[userId]){
					pendingAlts[userId] = [];
				}
				if(pendingAlts[userId].indexOf(altuser) === -1){
					pendingAlts[userId].push(altuser);
				}
				room.broadcast(user, "Now say ``~alt " + user.name + "`` on that account to link them. Make sure all your linked accounts are registered or your points may be at risk.");
			}
		}
	},
	removealt: function(message, args, user, rank, room, commandRank, commandRoom){
		let canEditOthers = AuthManager.rankgeq(commandRank, "@");
		if(args.length===0 || !args[0]){
			room.broadcast(user, "You must specify an alt.");
		}else{
			pgclient.getMains(user.id, args[0], idsMatch(args[0], user.id), (err, res)=>{
				if(err){
					error(err);
					room.broadcast(user, "Error: " + err);
					return;
				}

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
					pgclient.runSql(DELETE_ALT_SQL, [toId(args[0])], (err, res)=>{
						if(err){
							error(err);
							room.broadcast("Error: " + err);
						}

						if(res.rowCount === 0){
							room.broadcast(user, "That's weird, the query didn't delete anything. Something is probably wrong.");
						}else{
							room.broadcast(user, "Successfully removed the alt.");
						}
					});
				}
			});
		}
	},
	main: function(message, args, user, rank, room, commandRank, commandRoom){
		// 34
		let canEditOthers = AuthManager.rankgeq(commandRank, "@");
		if(args.length===0 || !args[0]){
			room.broadcast(user, "You must specify an alt.");
		}else if(args[0].length>20){
			room.broadcast(user, "That name is too long.");
		}else{
			pgclient.getMains(user.id, args[0], idsMatch(args[0], user.id), (err, res)=>{
				if(err){
					error(err);
					room.broadcast(user, "Error: " + err);
				}

				if(!res[0] && !canEditOthers){
					room.broadcast(user, "You do not have any alts.");
				}else if(!res[1]){
					room.broadcast(user, "That account has no alts.");
				}else if(!canEditOthers && res[0].id !== res[1].id){
					room.broadcast(user, "That account is not one of your alts.");
				}else{
					changeMains(res[1].id, removeFormatting(removeRank(args[0])), (err, res2)=>{
						if(err){
							error(err);
							room.broadcast(user, "Error: " + err);
						}

						if(!res[0] || res[0].id !== res[1].id){
							room.broadcast(user, "Their name was successfully changed.");
						}else{
							room.broadcast(user, "Your name was successfully changed.");
						}
					});
				}
			});
		}
	},
	removeformatting: function(message, args, user, rank, room, commandRank, commandRoom){
		// 22
		if(!AuthManager.rankgeq(commandRank,"@")){
			user.send("You rank isn't high enough to do that.");
		}else if (args.length < 1){
			user.send("You need to give a player to fix.");
		}else{
			let id = toId(args[0]);
			pgclient.getUser(id, false, (err, dbUser)=>{
				if(err){
					error(err);
					user.send("Error: " + err);
					return;
				}

				if(!dbUser){
					user.send("That user does not have an entry.");
				}else{
					changeMains(dbUser.id, dbUser.username, (err, res)=>{
						if(err){
							error(err);
							user.send("Error: " + err);
							return;
						}
						room.broadcast(user, "Successfully reset their main name.");
					});
				}
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
		}else if(!AuthManager.rankgeq(rank, config.timerRank)){
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
	minigame: function(message, args, user, rank, room, commandRank, commandRoom){
		let game = data.games[room.id];
		let command = toId(args[0]);
		if(!room.id){
			room.broadcast(user, "You must use this command in the room that has the minigame in it.");
		}else if(!game){
			room.broadcast(user, "There is no minigame in this room.");
		}else if(!game.chatCommands[command]){
			room.broadcast(user, "That command is not recognized.");
		}else{
			game.chatCommands[command](user, rank);
		}
	},
	minigamenew: function(message, args, user, rank, room, commandRank, commandRoom){
		let gameRoom = args[1] ? RoomManager.getRoom(toRoomId(args[1])) : room;
		let gameType = toId(args[0]);
		if(!AuthManager.rankgeq(commandRank, '+')){
			room.broadcast(user, "Your rank is not high enough to start minigames.");
		}else if(!gameRoom || !gameRoom.id){
			room.broadcast(user, "You must specify a valid room.");
		}else if(data.games[gameRoom.id]){
			room.broadcast(user, "There already a game in progress.");
		}else if(!minigames.gameTypes[gameType]){
			room.broadcast(user, "That game type does not exist.");
		}else{
			data.games[gameRoom.id] = new minigames.gameTypes[gameType](user, gameRoom, config, data.blacklistManager, data.leaderboard.customBp);
		}
	},
	minigameend: function(message, args, user, rank, room, commandRank, commandRoom){
		let gameRoom = args[1] ? RoomManager.getRoom(toRoomId(args[1])) : room;
		if(!AuthManager.rankgeq(commandRank, '+')){
			room.broadcast(user, "Your rank is not high enough to end minigames.");
		}else if(!gameRoom || !gameRoom.id){
			room.broadcast(user, "You must specify a valid room.");
		}else if(!data.games[gameRoom.id]){
			room.broadcast(user, "There is no game in progress.");
		}else{
			data.games[gameRoom.id].end();
			delete data.games[gameRoom.id];
		}
	},
	checkhost: function(message, args, user, rank, room, commandRank, commandRoom){
		let gameRoom = args[0] ? RoomManager.getRoom(toRoomId(args[0])) : room;
		if(!gameRoom || !gameRoom.id){
			room.broadcast(user, "You must specify a valid room.");
		}else if(!data.games[gameRoom.id]){
			room.broadcast(user, "There is no game in that room currently.");
		}else{
			room.broadcast(user, "The current host is " + data.games[gameRoom.id].getHost().name + ".");
		}
	},
	sethost: function(message, args, user, rank, room, commandRank, commandRoom){
		let gameRoom = args[1] ? RoomManager.getRoom(toRoomId(args[1])) : room;
		let newHost = gameRoom ? gameRoom.getUserData(toId(args[0])) : null;
		if(!AuthManager.rankgeq(commandRank, '+')){
			room.broadcast(user, "Your rank is not high enough to change the host");
		}else if(!gameRoom || !gameRoom.id){
			room.broadcast(user, "You must specify a valid room.");
		}else if(!data.games[gameRoom.id]){
			room.broadcast(user, "There is no game in that room currently.");
		}else if(!newHost){
			room.broadcast(user, "The user you specify must be in the room and not the current host.");
		}else{
			data.games[gameRoom.id].setHost(newHost);
			room.broadcast(user, newHost.name + " is now the host.");
		}
	},
	showpoints: function(message, args, user, rank, room, commandRank, commandRoom){
		let id = toId(args[0]);
		let roomId = args[1] ? toRoomId(args[1]) : room.id;
		if(!roomId){
			room.broadcast(user, "You must specify a room.");
			return;
		}else if(!data.games[roomId]){
			room.broadcast(user, "There is no game in progress.");
			return;
		}
		let scores = data.games[roomId].scores;
		if(id){
			let entry = scores[id];
			if(entry){
				room.broadcast(user, entry.user.name + "'s score is " + entry.score + ".", rank);
			}else{
				room.broadcast(user, entry.user.name + " does not have a score.", rank);
			}
		}else{
			let scoresArray = [];
			for(let p in scores){
				scoresArray.push(scores[p]);
			}
			scoresArray.sort((e1,e2)=>{return e1.score < e2.score});
			if(scoresArray.length == 0){
				room.broadcast(user, "No one has any points.", rank);
			}else{
				room.broadcast(user, "The current top scores are: " + scoresArray.slice(0,10).map(e=>{return "__" + e.user.name + "__ (" + e.score + ")"}).join(", "), rank);
			}
		}
	},
	nominate: function(message, args, user, rank, room, commandRank, commandRoom){
		let nominee = toId(args[0]);
		let entry = data.leaderboard.nominations[user.id];
		let game = data.games['trivia'];
		let question;
		let nomineeUser;
		if(!game){
			user.send("There isn't a Trivia Tracker game running currently.");
		}else if(!nominee){
			user.send("You must specify a user.");
		}else if(nominee === user.id){
			user.send("You can't nominate yourself.");
		}else{
			let history = game.history;
			for(let i=history.length-1;i>=0;i--){
				if(history[i].active.id == nominee){
					question = history[i].question;
					nomineeUser = history[i].active;
					break;
				}
			}
			if(!question){
				user.send("That user hasn't asked a question recently.");
			}else if(AuthManager.rankgeq(nomineeUser.rank, '%')){
				user.send("Staff members can't be nominated for best question.");
			}else if(entry){
				if(entry.lastUse && (Date.now() - entry.lastUse) < 300*1000){
					entry.nominee = nominee;
					entry.question = question;
					entry.timestamp = new Date().toUTCString();
					delete entry.lastUse;
					user.send("You have changed your nomination.");
					saveLeaderboard();
				}else{
					entry.lastUse = Date.now();
					user.send("Your current nomination is '" + entry.question + "'. Use ~nominate again to overwrite it.");
				}
			}else{
				data.leaderboard.nominations[user.id] = {
					nominator: user.id,
					nominee: nominee,
					question: question,
					timestamp: new Date().toUTCString()
				};
				user.send("You have nominated " + args[0] + ".");
				saveLeaderboard();
			}
		}
	},
	nominations: function(message, args, user, rank, room, commandRank, commandRoom){
		// For ROs only. Pastes all the nominations as a list
		if(!AuthManager.rankgeq(commandRank,'@')) return;

		let text = JSON.stringify(data.leaderboard.nominations, null, '\t');

		uploadText(text, (link)=>{
			user.send("Here is a list of all the nominations: " + link);
		}, (err)=>{
			user.send("There was an error: " + err);
		});
	},
	clearnominations: function(message, args, user, rank, room, commandRank, commandRoom){
		// For ROs only. Deletes all nominations and saves the leaderboard.
		if(!AuthManager.rankgeq(commandRank,'#')) return;

		data.leaderboard.nominations = {};
		saveLeaderboard();

		user.send("Successfully cleared all nominations.");
	},
	checknom: "checknomination",
	checknomination: function(message, args, user, rank, room, commandRank, commandRoom){
		let hasRank = AuthManager.rankgeq(commandRank, '@');
		let useArg = hasRank && args[0];
		let id = useArg ? toId(args[0]) : user.id;
		
		if(!data.leaderboard.nominations[id]){
			room.broadcast(user, (useArg ? "They" : "You") + " do not have a nomination.");
		}else{
			room.broadcast(user, (useArg ? "Their" : "Your") + " nomination is \"" + data.leaderboard.nominations[id].question + "\"");
		}
	},
	removenomination: function(message, args, user, rank, room, commandRank, commandRoom){
		let hasRank = AuthManager.rankgeq(commandRank, '@');
		let useArg = hasRank && args[0];
		let id = useArg ? toId(args[0]) : user.id;
		
		if(!data.leaderboard.nominations[id]){
			room.broadcast(user, (useArg ? "They" : "You") + " do not have a nomination.");
		}else{
			delete data.leaderboard.nominations[id];
			saveLeaderboard();
			room.broadcast(user, "Successfully deleted " + (useArg ? "their" : "your") + " nomination.");
		}
	},
	custbpadd: function(message, args, user, rank, room, commandRank, commandRoom){
		let hasRank = AuthManager.rankgeq(commandRank, '@');
		let id = toId(args[0]);
		let bpMessage = args.slice(1).join(', ');;
		
		if(!hasRank){
			room.broadcast(user, "Your rank is not high enough to set custom BP messages.");
		}else if(!id || !bpMessage){
			room.broadcast(user, "You must specify a user and a message.");
		}else{
			data.leaderboard.customBp[id] = bpMessage;
			saveLeaderboard();
			room.broadcast(user, "Successfully set their custom BP message.");
		}
	},
	custbpremove: function(message, args, user, rank, room, commandRank, commandRoom){
		let hasRank = AuthManager.rankgeq(commandRank, '@');
		let id = toId(args[0]);
		
		if(!hasRank){
			room.broadcast(user, "Your rank is not high enough to remove custom BP messages.");
		}else if(!id){
			room.broadcast(user, "You must specify a user.");
		}else if(!data.leaderboard.customBp[id]){
			room.broadcast(user, "They do not have a custom BP message.");
		}else{
			delete data.leaderboard.customBp[id];
			saveLeaderboard();
			room.broadcast(user, "Successfully removed their custom BP message.");
		}
	},
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
			room.broadcast(user, "There is already a game in " + room.name + ".");
		}else if(!AuthManager.rankgeq(commandRank, config.startGameRank)){
			room.broadcast(user, "Your rank is not high enough to start a game of Trivia Tracker.");
		}else{
			data.games[targetRoom.id] = new minigames.TriviaTrackerGame(user, targetRoom, config, data.blacklistManager, data.leaderboard.customBp);
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
			data.games[targetRoom.id].end();
			delete data.games[targetRoom.id];
		}
	}
};

let ttleaderboardCommands = {
	list: function(message, args, user, rank, room, commandRank, commandRoom){
		let lb = args[2] || "main";
		let number = /^[\d]+$/.test(args[1]) ? parseInt(args[1], 10) : 5;
		let rows = [];
		listLeaderboardEntries([number, lb], (err, res)=>{
			if(err){
				error(err);
				room.broadcast(user, "Error: " + err);
				return;
			}

			let rows = res.rows;
			if(!rows.length){
				room.broadcast(user, "There are no players on the " + lb + " leaderboard.", rank, true);
			}else{
				if(args[3] &&  AuthManager.rankgeq(commandRank, "%")){
					sayScores(rows, lb, room);
				}else{
					room.broadcast(user, "The top " + rows.length + " score" + (rows.length === 1 ? "" : "s") + " in the " + lb + " leaderboard " + (rows.length === 1 ? "is" : "are") + ": " + rows.map((row)=>{return "__" + (row.display_name || row.id1) + "__: " + row.points}).join(", ") + ".", rank, true);
				}
			}
		});
	},
	listall: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, "#")) return;
		let lb = toId(args[1]) || "main";
		pgclient.runSql(LIST_ALL_LB_ENTRIES_SQL, [lb], (err, res)=>{
			if(err){
				error(err);
				room.broadcast(user, "Error: " + err);
				return;
			}

			let rows = res.rows;
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
		});
	},
	check: function(message, args, user, rank, room, commandRank, commandRoom){
		let username = args[1] || user.name;
		let boardId = toId(args[2]) || "main";
		pgclient.runSql(GET_LB_SQL, [boardId], (err, res)=>{
			if(err){
				error(err);
				room.broadcast(user, "Error: " + err);
				return;
			}

			if(!res.rowCount){
				room.broadcast(user, "The leaderboard you entered does not exist.", rank, true);
			}else{
				let boardName = res.rows[0].display_name;
				pgclient.getUser(username, false, (err, res2)=>{
					if(err){
						error(err);
						room.broadcast(user, "Error " + err);
						return;
					}

					if(!res2){
						room.broadcast(user, username + " does not have a score on the " + boardName + " leaderboard.", rank, true);
					}else{
						getLeaderboardEntry([res2.id, boardId], (err, entry)=>{
							if(err){
								error(err);
								room.broadcast(user, "Error " + err);
								return;
							}

							if(!entry){
								room.broadcast(user, res2.display_name + " does not have a score on the " + boardName + " leaderboard.", rank, true);
							}else{
								room.broadcast(user, entry.display_name + "'s score on the " + boardName + " leaderboard is " + entry.points + ".", rank, true);
							}
						});
					}
				});
			}
		});
	},
	//Number of people, your place, your score, points to next place
	summary: function(message, args, user, rank, room, commandRank, commandRoom){
		let lbId = toId(args[1]) || "main";
		let userId = (AuthManager.rankgeq(commandRank, "%") && toId(args[2])) || user.id;
		pgclient.runSql(GET_ALL_LB_SQL, [], (err, res)=>{
			if(err){
				error(err);
				room.broadcast(user, "Error: " + err);
				return;
			}
			
			let lbEntry = res.rows.filter((row)=>{return row.id === lbId;})[0];
			if(!lbEntry){
				room.broadcast(user, "The leaderboard you entered does not exist.", rank);
			}else{
				let lbName = lbEntry.display_name;
				pgclient.getUser(userId, false, (err, res2)=>{
					if(err){
						error(err);
						room.broadcast(user, "Error " + err);
						return;
					}

					if(!res2){
						room.broadcast(user, "You do not have a score on the " + lbName + " leaderboard.", rank);
					}else{
						getLeaderboardEntry([res2.id, lbId], (err, entry)=>{
							if(err){
								error(err);
								room.broadcast(user, "Error " + err);
								return;
							}

							if(!entry){
								room.broadcast(user, "You do not have a score on the " + lbName + " leaderboard.", rank);
							}else{
								let score = entry.points;
								pgclient.runSql(GET_ALL_LB_ENTRIES_SQL, [lbId], (err, res3)=>{
									if(err){
										error(err);
										room.broadcast(user, "Error " + err);
										return;
									}

									let entries = res3.rows;
									if(entries.length === 0){
										room.broadcast(user, "There doesn't seem to be anyone on the leaderboard. Maybe something went wrong.", rank);
									}else if(entries.length === 1){
										room.broadcast(user, "You are the only person on the leaderboard (and your score is " + score + ").", rank);
									}else if(entries[0].points === score){
										let nextPlayer = idsMatch(entries[0].display_name, res2.display_name) ? entries[1] : entries[0];
										let response = "You are first on the leaderboard with " + score + " points."
										response += " Second place is __" + nextPlayer.display_name + "__ with " + entries[1].points + " points.";
										room.broadcast(user, response, rank);
									}else{
										let higherEntries = entries.filter(item=>{return item.points > score});
										let response = "First place is __" + entries[0].display_name + "__ with " + entries[0].points + " points.";
										response += " Your rank is " + (higherEntries.length+1) + " with " + score + " points.";
										response += " The next player above you is __" + higherEntries[higherEntries.length - 1].display_name + "__ with " + higherEntries[higherEntries.length - 1].points + " points.";
										room.broadcast(user, response, rank);
									}
								});
							}
						});
					}
				});
			}
		});
	},
	stats: function(message, args, user, rank, room, commandRank, commandRoom){
		let lbId = toId(args[1]) || 'main';
		pgclient.runSql(GET_ALL_LB_SQL, [], (err, res)=>{
			if(err){
				error(err);
				room.broadcast(user, "Error: " + err);
				return;
			}

			let lbEntry = res.rows.filter((row)=>{return row.id === lbId;})[0];
			if(!lbEntry){
				room.broadcast(user, "That leaderboard doesn't exist.", rank);
			}else{
				info(JSON.stringify(lbEntry));
				let lbName = lbEntry.display_name;
				pgclient.runSql(GET_STATS, [lbId], (err, res2)=>{
					if(err){
						error(err);
						room.broadcast(user, "Error: " + err);
						return;
					}

					if(res2.rowCount === 0 || res2.rows[0].num_players === 0){
						room.broadcast(user, "There are no players on that leaderboard.", rank);
					}else{
						let num = res2.rows[0].num_players;
						let std = Math.round(res2.rows[0].std_points*100)/100;
						let avg = Math.round(res2.rows[0].avg_points*10)/10;
						room.broadcast(user, "There are " + num + " players on the " + lbName + " leaderboard. The average score is " + avg + " and the standard deviation is " + std + ".", rank);
					}
				});
			}
		});
	},
	set: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank,config.editScoreRank)){
			room.broadcast(user, "Your rank is not high enough to change someone's score.", rank);
		}else if(args.length<=2 || !toId(args[1])){
			room.broadcast(user, "You must specify the user's name, and the number of points to add.", rank);
		}else if(!/^[\d]+$/.test(args[2])){
			room.broadcast(user, "Invalid number format for the number of points.", rank);
		}else{
			let username = args[1];
			let points = parseInt(args[2], 10);
			let boardId = toId(args[3]) || "main"
			pgclient.runSql(GET_LB_SQL, [boardId], (err, res)=>{
				if(err){
					error(err);
					room.broadcast(user, "Error: " + err);
					return;
				}

				let boardName = res.rowCount ? res.rows[0].display_name : null;
				if(!boardName){
					room.broadcast(user, "That leaderboard doesn't exist.", rank);
				}else{
					pgclient.updatePointsByPsId(toId(username), username , (oldPoints)=>{
						return points;
					}, [boardId], (err, name, num, res)=>{
						if(err){
							error(err);
							room.broadcast(user, "Error: " + err);
							return;
						}

						if(!res.rows[0].points === null){
							room.broadcast(user, "Created a new " + boardName + " leaderboard entry for " + username + " and set their score to " + newPoints + ".", rank);
						}else{
							room.broadcast(user, "Updated the score for " + entry.rows[0].display_name + ". Their " + boardName + " leaderboard score changed from " + entry.rows[0].points + " to " + points + ".", rank);
						}
					});
				}
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
			let username = args[1];
			let points = parseInt(args[2], 10);
			pgclient.updatePointsByPsId(toId(username), username, (oldPoints)=>{
				return Math.max(oldPoints + points, 0);
			}, 'enabled', (err, username, affected, failed)=>{
				if(err){
					error(err);
					room.broadcast(user, "Error: " + err);
					return;
				}

				let response = "Updated " + affected + " scores for " + username + ".";
				if(failed.length){
					response += " The following leaderboards failed to update: " + failed.join(", ") + ".";
				}
				room.broadcast(user, response, rank);
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
			let username = args[1];
			let points = parseInt(args[2], 10);
			let boardId = toId(args[3])
			pgclient.runSql(GET_LB_SQL, [boardId], (err, res)=>{
				if(err){
					error(err);
					room.broadcast(user, "Error: " + err);
					return;
				}
				
				if(!res.rowCount){
					room.broadcast(user, "That leaderboard doesn't exist.", rank);
				}else{
					let boardName = res.rows[0].display_name;
					updateLeaderboardEntryByUsername([username, boardId], (oldPoints)=>{
						return oldPoints + points;
					}, (err, res2, newPoints)=>{
						if(err){
							error(err);
							room.broadcast(user, "Error: " + err);
							return;
						}
						
						if(!res2){
							room.broadcast(user, "Created a new " + boardName + " leaderboard entry for " + username + " and set their score to " + newPoints + ".", rank);
						}else{
							room.broadcast(user, "Updated the score for " + res2.display_name + ". Their " + boardName + " leaderboard score changed from " + res2.points + " to " + newPoints + ".", rank);
						}
					});
				}
			});
		}
	},
	remove: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!toId(args[1])){
			room.broadcast(user, "You must specify a user.", rank);
		}else if(!AuthManager.rankgeq(commandRank, config.editScoreRank)){
			room.broadcast(user, "Your rank is not high enough to remove someone's leaderboard entries.", rank);
		}else{
			pgclient.getUser(args[1], false, (err, player)=>{
				if(err){
					error(err);
					room.broadcast(user, "Error: " + err);
					return;
				}

				if(!player){
					room.broadcast(user, args[1] + " does not have any leaderboard entries.", rank);
				}else{
					removeAllLeaderboardEntries(player.id, (err, res)=>{
						if(err){
							error(err);
							room.broadcast(user, "Error: " + err);
							return;
						}

						room.broadcast(user, "Removed " + res.rowCount + " leaderboard entries for " +	args[1] + ".", rank);
					});
				}
			});
		}
	},
	reset: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, config.resetLeaderboardRank)){
			room.broadcast(user, "Your rank is not high enough to reset the leaderboard.", rank);
		}else{
			if(idsMatch(user.id, data.askToReset)){
				try{
					// TODO can this just be pg_dump > filename?
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
							getAllLeaderboardEntries("main", (err, rows)=>{
								if(err){
									error(err);
									room.broadcast(user, "Error: " + err);
									return;
								}

								pgclient.getUser(user.id, true, (err, user)=>{
									if(err){
										error(err);
										room.broadcast(user, "Error: " + err);
										return;
									}

									pgclient.runSql(DELETE_LB_ENTRIES_SQL, ["main"], (err, res)=>{
										if(err){
											error(err);
											room.broadcast(user, "Error: " + err);
											return;
										}

										pgclient.runSql(RESET_MAIN_LB_SQL, [user.id], (err, res2)=>{
											if(err){
												error(err);
												room.broadcast(user, "Error: " + err);
												return;
											}

											room.broadcast(user, "Successfully deleted " + res.rowCount + " score(s) from the main leaderboard.", rank);
											data.askToReset = "";
											achievementsOnReset("main", rows);
										})
									});
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
		pgclient.runSql(GET_ALL_LB_SQL, [], (err, res)=>{
			if(err){
				error(err);
				room.broadcast(user, "Error: " + err);
				return;
			}

			if(!res.rowCount){
				room.broadcast(user, "There are no leaderboards right now.", rank);
			}else{
				let leaderboards = res.rows.map((row)=>{return row.display_name;});
				room.broadcast(user, "These are the current leaderboards: " + leaderboards.join(", "), rank);
			}
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
			let boardName = args[1];
			pgclient.runSql(GET_LB_SQL, [toId(boardName)], (err, res)=>{
				if(err){
					error(err);
					room.broadcast(user, "Error: " + err);
					return;
				}

				info("git here");

				if(res.rowCount){
					room.broadcast(user, "A leaderboard already exists with the same name.", rank);
				}else{
					pgclient.getUser(user.id, true, (error, res)=>{
						if(err){
							error(err);
							room.broadcast(user, "Error: " + err);
							return;
						}

						pgclient.runSql(INSERT_LB_SQL, [toId(boardName), boardName, res.id], (err, res2)=>{
							if(err){
								error(err);
								room.broadcast(user, "Error: " + err);
								return;
							}

							room.broadcast(user, "Successfully created a new leaderboard.", rank);
						});
					});
				}
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
			pgclient.runSql(GET_LB_SQL, [id], (err, res)=>{
				if(err){
					error(err);
					room.broadcast(user, "Error: " + err);
					return;
				}

				if(!res.rowCount){
					room.broadcast(user, "There is no leaderboard with that name.", rank);
				}else{
					pgclient.runSql(DELETE_LB_ENTRIES_SQL, [id],(err, res2)=>{
						if(err){
							error(err);
							room.broadcast(user, "Error: " + err);
							return;
						}

						pgclient.runSql(DELETE_LB_SQL, [id], (err, res3)=>{
							if(err){
								error(err);
								room.broadcast(user, "Error: " + err);
								return;
							}

							room.broadcast(user, "Successfully removed the leaderboard and deleted " + res2.rowCount + " score(s).", rank);
						});
					});
				}
			});
		}
	},
	info: function(message, args, user, rank, room, commandRank, commandRoom){
		let id = args[1] || "main";
		pgclient.runSql(GET_LB_SQL, [id], (err, res)=>{
			if(err){
				error(err);
				room.broadcast(user, "Error: " + err);
				return;
			}
			
			let lbEntry = res.rows[0];
			if(!res.rowCount){
				room.broadcast(user, "The leaderboard you specified doesn't exist.", rank);
			}else if(id !== "main"){
				room.broadcast(user, "Leaderboard name: " + lbEntry.display_name + ", created on: " + lbEntry.created_on.toUTCString() + ", created by: " + lbEntry.created_by + ", enabled: " + lbEntry.enabled, rank);
			}else{
				room.broadcast(user, "Leaderboard name: " + lbEntry.display_name + ", last reset: " + lbEntry.created_on.toUTCString() + ", reset by: " + lbEntry.created_by + ", enabled: " + lbEntry.enabled, rank);
			}
		});
	},
	enable: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, config.manageEventRank)){
			room.broadcast(user, "Your rank is not high enough to enable a leaderboard.", rank);
		}else if(args.length<2){
			room.broadcast(user, "You must specify the name for the leaderboard.", rank);
		}else{
			let id = toId(args[1]);
			pgclient.runSql(GET_LB_SQL, [id], (err, res)=>{
				if(err){
					error(err);
					room.broadcast(user, "Error: " + err);
					return;
				}
			
				let lbEntry = res.rows[0];
				if(!lbEntry){
					room.broadcast(user, "The leaderboard you specified doesn't exist.", rank);
				}else if(lbEntry.enabled){
					room.broadcast(user, "That leaderboard is already enabled.", rank);
				}else{
					pgclient.runSql(UPDATE_LB_SQL, [id, true], (err, res2)=>{
						if(err){
							error(err);
							room.broadcast(user, "Error: " + err);
							return;
						}
					
						room.broadcast(user, "Successfully enabled the " + lbEntry.display_name + " leaderboard.", rank);
					});
				}
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
			pgclient.runSql(GET_LB_SQL, [id], (err, res)=>{
				if(err){
					error(err);
					room.broadcast(user, "Error: " + err);
					return;
				}
			
				let lbEntry = res.rows[0];
				if(!lbEntry){
					room.broadcast(user, "The leaderboard you specified doesn't exist.", rank);
				}else if(!lbEntry.enabled){
					room.broadcast(user, "That leaderboard is already disabled.", rank);
				}else{
					pgclient.runSql(UPDATE_LB_SQL, [id, false], (err, res2)=>{
						if(err){
							error(err);
							room.broadcast(user, "Error: " + err);
							return;
						}
				
						room.broadcast(user, "Successfully disabled the " + lbEntry.display_name + " leaderboard.", rank);
					});
				}
			});
		}
	}
};

class BlacklistManager{

	constructor(){
		this.blacklist = {};
	}

	load(){
		let path = "data/blacklist.json";
		if(fs.existsSync(path)){
			this.blacklist = JSON.parse(fs.readFileSync(path, 'utf8'));
		}else{
			this.blacklist = {};
		}
	}

	save(){
		let path = "data/blacklist.json";
		fs.writeFile(path, JSON.stringify(this.blacklist, null, "\t"), logIfError);
	}

	addUser(username, duration, reason, giver){
		let id = toId(username);
		let entry = this.getEntry(id);
		let currentDuration = this.getDuration(entry);

		
		if((duration*60000 <= currentDuration && duration > 0) || currentDuration == -1) return "The duration given isn't longer than their current blacklist length.";

		if(duration < 0) duration = 0;
		
		this.blacklist[id] = {
			displayName: username,
			reason: reason,
			duration: duration*60000,
			time: Date.now()
		};
		this.save();

		let triviaRoom = RoomManager.getRoom('trivia');
		if(triviaRoom){
			let durationText = duration ? "for " + millisToTime(duration*60000) : "permanently";
			triviaRoom.send("/modnote " + username + " (" + id + ") was added to the Trivia Tracker blacklist " + durationText + " by " + giver.name + ". (" + reason + ")");
		}
	}

	removeUser(username, giver){
		let id = toId(username);
		let entry = this.getEntry(id);

		if(!entry) return "The user " + username + " is not on the TT blacklist.";

		delete this.blacklist[id];
		this.save()
		
		let triviaRoom = RoomManager.getRoom('trivia');
		if(triviaRoom){
			triviaRoom.send("/modnote " + username + " was removed from the Trivia Tracker blacklist by " + giver.name);
		}
	}

	getEntry(id){
		let entry = this.blacklist[id];
		if(!entry) return;
		if(this.getDuration(entry) === 0){
			delete this.blacklist[id];
			this.save();
			return;
		}

		return entry;
	}

	getDuration(entry){
		if(!entry) return 0;
		if(!entry.duration) return -1;
		let duration = entry.duration - Date.now() + entry.time;
		duration = duration < 0 ? 0 : duration;
		return duration
	}
}

// TODO remove this middleman commands and make the chat commands directly reference the manager
let blacklistCommands = {
	add: function(username, id, duration, reason, user, room, triviaRoom){
		let response = data.blacklistManager.addUser(username, duration, reason, user);
		if(response){
			room.broadcast(user, response);
		}else{
			room.broadcast(user, "Added " + username + " to the TT blacklist.");
		}
		let game = data.games[triviaRoom.id];
		for(let roomId in data.games){
			data.games[roomId].onPunishment(data.games[roomId].room.getUserData(id), 'ttbl');
		}
	},
	remove: function(username, id, duration, reason, user, room, triviaRoom){
		let response = data.blacklistManager.removeUser(username, user);
		if(response){
			room.broadcast(user, response);
		}else{
			room.broadcast(user, "Removed " + username + " from the TT blacklist.");
		}
	},
	check: function(username, id, duration, reason, user, room, triviaRoom){
		let entry = data.blacklistManager.getEntry(id);
		if(entry && !entry.duration){
			room.broadcast(user, "The user " + entry.displayName + " is permantently on the blacklist. Reason: " + entry.reason + ".");
		}else if(entry){
			room.broadcast(user, "The user " + entry.displayName + " is on the blacklist for " + millisToTime(entry.duration - Date.now() + entry.time) + ". Reason: " + entry.reason + ".");
		}else{
			room.broadcast(user, "The user " + username + " is not on the blacklist.");
		}
	},
	unmute:function(username, id, duration, reason, user, room, triviaRoom){
		let entry = data.blacklistManager.getEntry(id);
		if(!entry){
			room.broadcast(user, "The user " + username + " is not on the blacklist.");
		}else if(!entry.duration || entry.duration > 60*60000){
			room.broadcast(user, "That user is blacklisted for longer than a mute.");
		}else{
			data.blacklistManager.removeUser(username, user);
			room.broadcast(user, "Unmuted " + username + ".");
		}
	}
};

let sayScores = function(scores, lb, room){
	let message = "/addhtmlbox <table style=\"background-color: #45cc51; margin: 2px 0;border: 2px solid #0d4916;color: black\" border=1><tr style=\"background-color: #209331\"><th colspan=\"2\">" + lb + "</th></tr><tr style=\"background-color: #209331\"><th style=\"width: 150px\">User</th><th>Score</th></tr>";
	for(let i=0;i<scores.length;i++){
		message = message + "<tr><td>" + (scores[i].display_name || scores[i].id1) + "</td><td>" + scores[i].points + "</td></tr>";
	}
	message = message + "</table>"

	room.send(message);
}

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

// TODO is the leaderboard file still needed? blacklists are stored elsewhere
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
		if(!leaderboard.nominations){
			leaderboard.nominations = {};
		}
		if(!leaderboard.customBp){
			leaderboard.customBp = {};
		}
		data.leaderboard = leaderboard;
		saveLeaderboard();
	}else{
		data.leaderboard = {blacklist:{},nominations:{},customBp:{}};
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

// TODO should be removed when ~minigame is repurposed
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

// TODO should be removed when ~minigame is repurposed
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
	let triviaRoom = RoomManager.getRoom(GOVERNING_ROOM);
	let callback = (err, username, achievement)=>{
		if(err){
			error(err);
			return;
		}

		if(triviaRoom) triviaRoom.send(username + " has earned the achievement '" + achievement + "'!");
	}
	if(scores.length > 0 && leaderboard === "main" && achievements){ // Awarding achievements
		let firstPlace = scores.filter((e)=>{return e.points === scores[0].points});
		for(let i=0;i<firstPlace.length;i++){
			achievements.awardAchievement(firstPlace[i].display_name, "Hatmor", callback);
		}
		let num = firstPlace.length;
		while(num<5 && num < scores.length){ // Using black magic to find all players in the top 5
			num += scores.filter((e)=>{return e.points === scores[num].points}).length;
		}
		let top5 = scores.slice(firstPlace.length, num);
		for(let i=0;i<top5.length;i++){
			achievements.awardAchievement(top5[i].display_name, "Elite", callback);
		}
		let message = "Congratulations to " + prettyList(firstPlace.map((e)=>{return e.display_name})) + " for getting first";
		if(top5.length){
			message += ", and to " + prettyList(top5.map((e)=>{return e.display_name})) + " for being in the top five!";
		}else{
			message += "!"
		}
		if(!triviaRoom) return;
		triviaRoom.send(message);
		if(num === 5 && scores.length > 5){
			let consolation = scores.filter((e)=>{return e.points === scores[5].points});
			for(let i=0;i<consolation.length;i++){
				achievements.awardAchievement(consolation[i].display_name, "Consolation Prize", callback);
			} }
	}
}

let achievementsOnScoreUpdate = function(user, leaderboard, oldScore, newScore){
	let triviaRoom = RoomManager.getRoom(GOVERNING_ROOM);
	let callback = (err, username, achievement)=>{
		if(err){
			error(err);
			return;
		}

		if(triviaRoom) triviaRoom.send(username + " has earned the achievement '" + achievement + "'!");
	}
	if(leaderboard === "main" && achievements){
		if(oldScore<250 && newScore >= 250){
			achievements.awardAchievement(user, "Super", callback);
		} if(oldScore<500 && newScore >= 500){
			achievements.awardAchievement(user, "Mega", callback);
		}
		if(oldScore<750 && newScore >= 750){
			achievements.awardAchievement(user, "Ultra", callback);
		}
		if(oldScore<1000 && newScore >= 1000){
			achievements.awardAchievement(user, "Hyper", callback);
		}
	}
}

// TODO move this to a general helper function file
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
