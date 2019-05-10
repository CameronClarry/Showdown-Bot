let fs = require("fs");
let self = {js:{},data:{},requiredBy:[],hooks:{},config:{}};
let chat = null;
let auth = null;
let rooms = null;
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
	pgclient.js.runSql(GET_LB_ENTRY_SQL, [args[0], toId(args[1])], (row)=>{
		res = row;
	}, ()=>{
		if(onEnd) onEnd(res);
	}, onError);
};

//args is [number of entries to get, leaderboard]
let listLeaderboardEntries = function(args, onRow, onEnd, onError){
	pgclient.js.runSql(LIST_LB_ENTRIES_SQL.replace("_NUMBER_",args[0]), [toId(args[1])], onRow, onEnd, onError);
};

let getAllLeaderboardEntries = function(leaderboard, onEnd, onError){
	let entries = [];
	pgclient.js.runSql(GET_ALL_LB_ENTRIES_SQL, [toId(leaderboard)], (row)=>{
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
			pgclient.js.runSql(INSERT_LB_ENTRY_SQL, [args[0], args[1], newScore], null, ()=>{
				if(onEnd){
					achievementsOnScoreUpdate(args[2], args[1], 0, newScore);
					onEnd(res, newScore);
				}
			}, onError);
		}else{
			let newScore = updateFunc(res.points);
			pgclient.js.runSql(UPDATE_LB_ENTRY_SQL, [args[0], args[1], newScore], null, ()=>{
				if(onEnd){
					achievementsOnScoreUpdate(args[2], args[1], res.points, newScore);
					onEnd(res, newScore);
				}
			}, onError);
		}
	}, onError);
};

let updateLeaderboardEntryByUsername = function(args, updateFunc, onEnd, onError){
	pgclient.js.getId(args[0], true, (res)=>{
		updateLeaderboardEntryById([res.id, args[1], res.display_name], updateFunc, onEnd, onError);
	}, onError);
}

//updateFunc takes the old score, and returns what the new score should be
//onEnd takes the user id, rows updated, array of events failed
let updateAllLeaderboardEntriesById = function(id, username, updateFunc, onEnd, onError, eventFilter){
	let events = [];
	pgclient.js.runSql(GET_ENABLED_LB_SQL, [], (row)=>{
		events.push(row);
	}, ()=>{
		let entries = {};
		pgclient.js.runSql(GET_LB_ENTRIES_SQL, [id], (row)=>{
			entries[row.leaderboard] = row;
		}, ()=>{
			events = events.map((event)=>{return event.id});
			if(eventFilter){
				info('Found filter, filtering.')
				events = events.filter(eventFilter)
			}
			let	pendingEvents = events.length;
			let failed = [];
			let newEnd = (event)=>{
				return ()=>{
					pendingEvents--;
					if(pendingEvents===0 && onEnd) onEnd(id, events.length - failed.length, failed);
				};
			};
			let newError = (event)=>{
				return (err)=>{
					error(err);
					pendingEvents--;
					failed.push(event);
					if(pendingEvents===0 && onEnd) onEnd(id, events.length - failed.length, failed);
				};
			};
			for(let i=0;i<events.length;i++){
				if(entries[events[i]]){
					pgclient.js.runSql(UPDATE_LB_ENTRY_SQL, [id, events[i], updateFunc(entries[events[i]].points)], null, newEnd(events[i]), newError(events[i]));
					achievementsOnScoreUpdate(username, events[i], entries[events[i]].points, updateFunc(entries[events[i]].points));
				}else{
					pgclient.js.runSql(INSERT_LB_ENTRY_SQL, [id, events[i], updateFunc(0)], null, newEnd(events[i]), newError(events[i]));
					achievementsOnScoreUpdate(username, events[i], 0, updateFunc(0));
				}
			}
			if(events.length === 0) onEnd(id, 0, 0);
		}, onError);
	}, onError);
}

let updateAllLeaderboardEntriesByUsername = function(username, updateFunc, onEnd, onError, eventFilter){
	pgclient.js.getId(username, true, (res)=>{
		updateAllLeaderboardEntriesById(res.id, res.display_name, updateFunc, (id, affected, failed)=>{
			if(onEnd) onEnd(res.display_name, affected, failed);
		}, null, eventFilter);
	}, onError);
}

//args is [id, leaderboard]
let removeLeaderboardEntry = function(args, onEnd, onError){
	let res;
	getLeaderboardEntry(args, (res)=>{
		if(!res){
			onEnd(res);
		}else{
			pgclient.js.runSql(DELETE_LB_ENTRY_SQL, args, ()=>{}, ()=>{
				if(onEnd){
					onEnd(res);
				}
			}, onError);
		}
	}, onError);
};

let removeAllLeaderboardEntries = function(id, onEnd, onError){
	pgclient.js.runSql(DELETE_USER_ENTRIES_SQL, [id], null, onEnd, onError);
}

let transferAllPoints = function(fromId, toId, onEnd, onError, onAllFinished){
	let success = true;
	let fromEntries = {};
	let entriesToTransfer = 0;
	pgclient.js.runSql(GET_LB_ENTRIES_SQL, [fromId], (row)=>{
		fromEntries[row.leaderboard] = row;
		entriesToTransfer++;
	}, ()=>{
		let toEntries = {};
		pgclient.js.runSql(GET_LB_ENTRIES_SQL, [toId], (row)=>{
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
					pgclient.js.runSql(UPDATE_LB_ENTRY_SQL, [toId, event, toEntries[event].points + fromEntries[event].points], null, endFunc, errorFunc);
				}else{
					pgclient.js.runSql(INSERT_LB_ENTRY_SQL, [toId, event, fromEntries[event].points], null, endFunc, errorFunc);
				}
			}
		}, onError);
	}, onError);
};

let changeMains = function(id, newName, onEnd, onError){
	pgclient.js.runSql(UPDATE_USER_SQL, [id, newName, toId(newName)], null, onEnd, onError);
}

// Merges two alts, and their points
let mergeAlts = function(fromName, toName, onEnd, onError){
	pgclient.js.getMains(fromName, toName, true, (res)=>{
		if(res[0].id === res[1].id){
			onError("Those two accounts are the same.");
			return;
		}
		transferAllPoints(res[0].id, res[1].id, null, null, (success)=>{
			if(success){
				pgclient.js.runSql(UPDATE_MAINS_SQL, [res[0].id, res[1].id], null, ()=>{
					pgclient.js.runSql(DELETE_USER_SQL, [res[0].id], null, ()=>{
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

exports.onLoad = function(module, loadData){
	self = module;
	self.js.refreshDependencies();
	if(loadData){
		self.data = {
			games: {},
			pendingAlts: {},
			askToReset: "",
			timers: {},
			tempVoices: {},
			flags: {}
		};
		loadFacts();
		loadBatches();
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
						if(idsMatch(lastHist.active, args[2])){
							if(!game.bpOpen){
								game.timeout = setTimeout(function(){
									try{
										if(!game.bpOpen){
											game.bpOpen = "leave";
											game.timeout = null;
											if(chat&&chat.js){
												chat.js.say(room, "**" + lastHist.active.trim() + " has left, so BP is now open (say 'me' or 'bp' to claim it).**");
											}
										}
									}catch(e){
										error("Error with player leave callback");
										error(e.message);
									}
								}, self.config.leaveGraceTime*1000);
							}
						}
					}else if(command === "n"){
						if(idsMatch(lastHist.active, args[3])){
							lastHist.active = removeFormatting(args[2].trim());
							if(args[2][0] === "‽" || args[2][0] === "!"){ // Let's go ahead and open BP if the user is muted or locked
								if(!game.bpOpen){
									chat.js.say(room, "**BP is now open (say 'me' or 'bp' to claim it).**");
								}
								game.bpOpen = "auth";
							}
						}
					}else if(command === "j"){
						if((game.timeout || game.bpOpen === "leave") && idsMatch(lastHist.active, args[2])){
							if(game.timeout){
								clearTimeout(game.timeout);
								game.timeout = null;
							}
							if(game.bpOpen == "leave"){
								game.bpOpen = null;
								chat.js.say(room, "**" + args[2].trim() + " has rejoined, so BP is no longer open.**");
							}
						}
					}else if(command === "unlink" && args[2].toLowerCase() === "hide"){
						if(idsMatch(args[3], lastHist.active)){
							// The user must've done something very bad so opening BP is probably a good idea
							if(!game.bpOpen){
								chat.js.say(room, "**BP is now open (say 'me' or 'bp' to claim it).**");
							}
							game.bpOpen = "auth";
						}
					}
				}
			}
		}
	};
};
exports.onUnload = function(){
	for(let name in self.data.timers){
		let t = self.data.timers[name];
		clearTimeout(t.timer);
		delete self.data.timers[name]
	}
};
exports.refreshDependencies = function(){
	chat = getModuleForDependency("chat", "tt");
	auth = getModuleForDependency("auth", "tt");
	rooms = getModuleForDependency("rooms", "tt");
	pgclient = getModuleForDependency("pgclient", "tt");
	achievements = getModuleForDependency("achievements", "tt");
};
exports.onConnect = function(){

};

let messageListener = function(m){
	let game = self.data.games[m.room];
	if(game){
		let history = game.history;
		let lastHist = history[history.length-1];
		if(game.bpOpen){
			let text = toId(m.message);
			if(text === "bp" || text === "me" || text === "bpme"){
				if(!idsMatch(m.user, mainConfig.user)){
					let displayName = rooms.js.getDisplayName(m.user, m.room);
					if(displayName){
						let result = tryBatonPass(m.room, displayName, {active:displayName,undo: null}, game.bpOpen !== "auth", self.config.remindTime/2, true);
						if(result.result){
							chat.js.say(m.room, result.response);
						}
					}
				}
			}
		}
		let rank = auth.js.getEffectiveRoomRank(m, "trivia");
		if((auth.js.rankgeq(rank, self.config.manageBpRank) || idsMatch(lastHist.active, m.user)) && (/\*\*([^\s].*)?veto(.*[^\s])?\*\*/i.test(m.message) || /^\/announce .*veto.*/i.test(m.message)) && !idsMatch(m.user, mainConfig.user)){
			if(lastHist.hasAsked){
				lastHist.hasAsked = false;
				clearTimers(game);
				game.remindTimer = setTimeout(()=>{
					onRemind(game);
				}, self.config.remindTime*1000/2);
			}

			if(auth.js.rankgeq(rank, self.config.manageBpRank) && (/boldfail/i.test(toId(m.message)))){
				chat.js.say(m.room, "!rfaq bold");
			}

		}else if(idsMatch(lastHist.active, m.user) && /\*\*(([^\s])|([^\s].*[^\s]))\*\*/g.test(m.message)){
			clearTimers(game);
			lastHist.hasAsked = true;
		}
		if(game && self.data.flags["timer"] && /\*\*(([^\s])|([^\s].*[^\s]))\*\*/g.test(m.message)){
			let timerName = "room:" + m.room;
			if(self.data.timers[timerName]){
				clearTimeout(self.data.timers[timerName].timer);
				delete self.data.timers[timerName];
			}
			self.data.timers[timerName] = {
				room: m.room,
				timer: setTimeout(()=>{
					delete self.data.timers[timerName];
					chat.js.say(m.room, "/wall Timer's up!");
				}, 60*1000)
			};
			chat.js.say(m.room, "Set the timer for one minute.");
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
	event: function(message, args, rank){
		if(args.length>0){
			let command = args[0].toLowerCase();
			if(ttleaderboardEventCommands[command]){
				ttleaderboardEventCommands[command](message, args, rank);
			}
		}
	},
	yea: "yes", yup: "yes", sure: "yes", yee: "yes", yep: "yes", yeah: "yes",
	hellyeah: "yes", ofcourse: "yes", butofcourse: "yes", go: "yes",
	gottem: "yes", youknowit: "yes", oui: "yes", si: "yes", right: "yes",
	aye: "yes", ya: "yes", ye: "yes", correct: "yes", ja: "yes",
	correctomundo: "yes", indeed: "yes", damnright: "yes",
	yes: function(message, args, rank){
		let shouldUndo = false;
		let room = message.room;
		let success = false;
		if(args.length>1 && auth.js.rankgeq(rank, self.config.manageBpRank) && toId(args[1]) === "afk"){
			shouldUndo = true;
		}else if(args.length>1 && auth.js.rankgeq(rank, self.config.manageBpRank)){
			room = toRoomId(args[1]);
		}
		let response = "There is no trivia game in " + room + ".";
		let game = self.data.games[room];
		if(game){
			response = "You must specify a player.";
			if(args.length>0){
				let history = game.history;
				response = "You either are not the active user or do not have a high enough rank to use this command.";
				let userMatchesHistory = idsMatch(history[history.length-1].active, message.user);
				if(userMatchesHistory && !history[history.length-1].hasAsked && !auth.js.rankgeq(rank, self.config.manageBpRank)){
					response = "You must ask a question in bold before you use ~yes. If your question was veto'd, please ask a new one or discuss it with a staff member.";
				}else if(!auth.js.rankgeq(rank, self.config.manageBpRank) && game.bpOpen){
					response = "You cannot ~yes while bp is open.";
				}else if(auth.js.rankgeq(rank, self.config.manageBpRank) || userMatchesHistory){
					let nextPlayer = rooms.js.getDisplayName(args[0], room);
					let result = tryBatonPass(room, args[0], {active:nextPlayer, undo:function(){
						updateAllLeaderboardEntriesByUsername(nextPlayer, (oldPoints)=>{
							return Math.max(oldPoints - self.config.correctPoints, 0);
						});
					}}, shouldUndo);
					success = result.result;
					if(success){
						updateAllLeaderboardEntriesByUsername(nextPlayer, (oldPoints)=>{
							return oldPoints + self.config.correctPoints;
						});
						chat.js.say(room, result.response);
					}else{
						if(nextPlayer && getBlacklistEntry(toId(nextPlayer))){
							if(!game.bpOpen){
								response = "**" + nextPlayer.trim() + " is on the blacklist, so BP is now open.**"
							}else{
								response = result.response;
							}
							game.bpOpen = "auth";
							chat.js.say(room, response);
							success = true;
						}else{
							response = result.response;
						}
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
		if(args.length>1 && auth.js.rankgeq(rank, self.config.manageBpRank)){
			room = toRoomId(args[1]);
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
			response = "You either are not the active user or do not have a high enough rank to use this command.";

			if(auth.js.rankgeq(rank, self.config.manageBpRank) || (idsMatch(message.user, history[history.length-1].active) && number === 1)){
				if(game.lastNo && Date.now() - game.lastNo < 5000){
					response = "There is a cooldown between uses of ~no, try again in a few seconds.";
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
					game.bpOpen = null;
					if(history.length>0){
						let newActive = history[history.length-1].active;
						let newDisplayName = rooms.js.getDisplayName(newActive, room);
						if(newDisplayName){
							if(newDisplayName[0] === "!" || newDisplayName[0] === "‽"){
								response += ". Since " + newActive + " is muted or locked, BP is open.**";
								game.bpOpen = "auth";
							}else{
								response += ", it is now " + newActive + "'s turn to ask a question.**";
							}
						}else{
							if(user){
								history.add({active: user, undo: null});
								response += ". Since " + newActive + " is not in the room, it is now " + user + "'s turn to ask a question.**";
							}else{
								response += ". Since " + newActive + " is not in the room, BP is open.**";
								game.bpOpen = "auth";
							}
						}
					}else{
						if(user){
							history.add({active: user, undo: null});
							response += ". Since the end of the history was reached, it is now " + message.user + "'s turn to ask a question.**";
						}else{
							". Since the end of the history was reached and the person who used the command is not here for some reason, BP is open.**";
							game.bpOpen = "auth";
							if(game.timeout){
								clearTimeout(game.timeout);
								game.timeout = null;
							}
						}
					}
					if(!game.bpOpen){
						game.remindTimer = setTimeout(()=>{
							onRemind(game);
						}, self.config.remindTime*1000);
					}
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
		if(args.length>1 && auth.js.rankgeq(rank, self.config.manageBpRank)){
			room = toRoomId(args[1]);
		}else if(args.length === 0){
			room = "trivia";
		}
		let response = "There is no trivia game in " + room + ".";
		let game = self.data.games[room];
		if(game){
			response = "You must specify a player.";
			if(args.length>0 && args[0]){
				let history = game.history;
				response = "Your rank is not high enough to use this command.";
				if(auth.js.rankgeq(rank, self.config.manageBpRank)){
					let nextPlayer = rooms.js.getDisplayName(args[0], room);
					let result = tryBatonPass(room, args[0], {active: nextPlayer, undo: null}, false);
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
				chat.js.strictReply(message, name + " currently has BP" + (game.bpOpen ? " (BP is open)." : "."));
				success = true;
			}
		}
		if(!success){
			chat.js.strictReply(message, response);
		}
	},
	openbp: "bpopen",
	bpopen: function(message, args, rank){
		let success = false;
		let response = "You must specify a room.";
		let room = (message.source === "pm" && auth.js.rankgeq(rank, self.config.manageBpRank)) ? args[0] : message.room;
		if(room){
			let game = self.data.games[room];
			if(!game){
				response = "There is no game in " + room + ".";
			}else{
				let lastHist = game.history[game.history.length-1];
				if(auth.js.rankgeq(rank, self.config.manageBpRank)){
					if(!game.bpOpen){
						chat.js.say(room, "**BP is now open (say 'me' or 'bp' to claim it).**");
						game.bpOpen = "auth";
						success = true;
					}else if(game.bpOpen !== "auth"){
						game.bpOpen = "auth";
						success = true;
					}else{
						response = "BP is already open.";
					}
				}else if(idsMatch(lastHist.active, message.user)){
					if(!game.bpOpen){
						success = true;
						game.bpOpen = "user";
						chat.js.say(room, "**BP is now open (say 'me' or 'bp' to claim it).**");
					}else{
						response = "BP is already open.";
					}
				}else{
					response = "You either are not the active player or are not ranked high enough to open BP.";
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
			let game = self.data.games[room];
			if(!game){
				response = "There is no game in " + room + ".";
			}else{
				response = "You either are not the active player or are not ranked high enough to open BP.";
				let lastHist = game.history[game.history.length-1];
				if(auth.js.rankgeq(rank, self.config.manageBpRank)){
					if(game.bpOpen){
						success = true;
						game.bpOpen = null;
						chat.js.say(room, "**BP is now closed.**");
					}else{
						response = "BP is not open.";
					}
					clearTimers(game);

				}else if(idsMatch(lastHist.active, message.user) && game.bpOpen === "user"){
						success = true;
						game.bpOpen = null;
						chat.js.say(room, "**BP is now closed.**");
				}
			}
		}
		if(!success){
			chat.js.reply(message, response);
		}
	},
	//~ttblacklist add/remove/check, [user], {duration}, {reason}
	ttbl: "ttblacklist",
	ttblacklist: function(message, args, rank){
		let response = "Your rank is not high enough to use the blacklist command.";
		let leaderboard = self.data.leaderboard;
		if(!auth.js.rankgeq(rank,self.config.manageBlRank)){
			chat.js.reply(message, "Your rank is not high enough to use the blacklist command.");
		}else if(args.length < 2){
			chat.js.reply(message, "Not enough arguments were given for the blacklist command.");
		}else{
			let command = toId(args[0]);
			let id = toId(args[1]);
			let duration = /^\d+$/.test(args[2]) ? parseInt(args[2]) : 0;
			let reason = args[3] || "No reason given";
			if(!id){
				chat.js.reply(message, "You must specify a user.");
			}else if(!blacklistCommands[command]){
				chat.js.reply(message, command + " is not a recognized command.");
			}else{
				blacklistCommands[command](message, args[1], id, duration, reason);
			}
		}
	},
	ttmute: function(message, args, rank){
		let leaderboard = self.data.leaderboard;
		if(!auth.js.rankgeq(rank,'%')){
			chat.js.reply(message, "Your rank is not high enough to use the mute commands.");
		}else{
			let id = toId(args[0]);
			let duration = 7
			let reason = args[1] || "No reason given";
			if(!id){
				chat.js.reply(message, "You must specify a user.");
			}else{
				blacklistCommands['add'](message, args[0], id, duration, reason);
			}
		}
	},
	tthourmute: function(message, args, rank){
		let leaderboard = self.data.leaderboard;
		if(!auth.js.rankgeq(rank,'%')){
			chat.js.reply(message, "Your rank is not high enough to use the mute commands.");
		}else{
			let id = toId(args[0]);
			let duration = 60
			let reason = args[1] || "No reason given";
			if(!id){
				chat.js.reply(message, "You must specify a user.");
			}else{
				blacklistCommands['add'](message, args[0], id, duration, reason);
			}
		}
	},
	ttunmute: function(message, args, rank){
		let leaderboard = self.data.leaderboard;
		if(!auth.js.rankgeq(rank,'%')){
			chat.js.reply(message, "Your rank is not high enough to use the mute commands.");
		}else{
			let id = toId(args[0]);
			let duration;
			let reason;
			if(!id){
				chat.js.reply(message, "You must specify a user.");
			}else{
				blacklistCommands['unmute'](message, args[0], id, duration, reason);
			}
		}
	},
	alts: function(message, args, rank){
		let target = toId(args[0]) ? args[0] : message.user;
		pgclient.js.getMains(message.user, target, false, (res)=>{
			if(!auth.js.rankgeq(rank, "%") && (!res[0] || !res[1] || (res[0].id !== res[1].id))){
				chat.js.reply(message, "Your rank is not high enough to check other users' alts.")
			}else if(!res[1]){
				chat.js.reply(message, target + " does not have any alts.");
			}else{
				let alts = [];
				pgclient.js.runSql(GET_ALTS_SQL, [res[1].id], (row)=>{
					alts.push(row);
				}, ()=>{
					alts = alts.map((alt)=>{return alt.username});
					if(alts.length === 0){
						chat.js.reply(message, target + " does not have any alts");
					}else if(alts.length < 11){
						chat.js.reply(message, res[1].display_name + "'s alts: " + alts.join(", "));
					}else{
						let text = res[1].display_name + "'s alts:\n\n" + alts.join("\n");
						request.post({url:'https://hastebin.com/documents', body: text}, function(err,httpResponse,body){
							try{
								chat.js.reply(message, "There were more than 10 alts, so they were put in a hastebin: hastebin.com/" + JSON.parse(body).key);
							}catch(e){
								error(e.message);
								chat.js.reply(message, "Something was wrong with the response from hastebin. Here are the first 6 alts of " + alts.length + ": " + alts.slice(0,6).join(", "));
							}
						});
					}
				}, (err)=>{
					error(err);
					chat.js.reply(message, "Something went wrong finding " + target + "'s alts.");
				});
			}
		}, (err)=>{
			error(err);
			chat.js.reply(message, "There was an error verifying your main account.");
		});
	},
	alt: function(message, args, rank){
		let pendingAlts = self.data.pendingAlts;
		if(args.length === 0){
			chat.js.reply(message, "You must specify an alt.");
		}else{
			let user = toId(message.user);
			let altuser = toId(args[0]);
			if(pendingAlts[altuser] && pendingAlts[altuser].indexOf(user)>-1){
				mergeAlts(altuser, user, ()=>{
					pendingAlts[altuser].splice(pendingAlts[altuser].indexOf(user),1);
					if(pendingAlts[altuser].length === 0){
						delete pendingAlts[altuser];
					}
					chat.js.reply(message, "Successfully linked accounts.");
				}, (err)=>{
					error(JSON.stringify(err));
					chat.js.reply(message, "There was an error while linking accounts: " + JSON.stringify(err));
				});
			}else{
				if(!pendingAlts[user]){
					pendingAlts[user] = [];
				}
				if(pendingAlts[user].indexOf(altuser) === -1){
					pendingAlts[user].push(altuser);
				}
				chat.js.reply(message, "Now say \"~alt " + user + "\" on that account to link them. Make sure all your linked accounts are registered or your points may be at risk.");
			}
		}
	},
	removealt: function(message, args, rank){
		let canEditOthers = auth.js.rankgeq(rank, "@");
		if(args.length===0 || !args[0]){
			chat.js.reply(message, "You must specify an alt.");
		}else{
			pgclient.js.getMains(message.user, args[0], idsMatch(args[0], message.user), (res)=>{
				if(!res[0] && !canEditOthers){
					chat.js.reply(message, "You do not have any alts.");
				}else if(!res[1]){
					chat.js.reply(message, "That account has no alts.");
				}else if(res[0].id !== res[1].id && !canEditOthers){
					chat.js.reply(message, "That account is not an alt of yours.");
				}else if(idsMatch(args[0], res[1].display_name)){
					if(res[0].id !== res[1].id){
						chat.js.reply(message, "You cannot remove their main account.");
					}else{
						chat.js.reply(message, "You cannot remove your main account.");
					}
				}else{
					pgclient.js.runSql(DELETE_ALT_SQL, [toId(args[0])], null, (res)=>{
						if(res.rowCount === 0){
							chat.js.reply(message, "That's weird, the query didn't delete anything. Something is probably wrong.");
						}else{
							chat.js.reply(message, "Successfully removed the alt.");
						}
					}, (err)=>{
						error(err);
						chat.js.reply(message, "There was an error removing the alt.");
					})
				}
			}, (err)=>{
				error(err);
				chat.js.reply(message, "Something went wrong when finding your main.");
			});
		}
	},
	main:function(message, args, rank){
		let canEditOthers = auth.js.rankgeq(rank, "@");
		if(args.length===0 || !args[0]){
			chat.js.reply(message, "You must specify an alt.");
		}else if(args[0].length>20){
			chat.js.reply(message, "That name is too long.");
		}else{
			pgclient.js.getMains(message.user, args[0], idsMatch(args[0], message.user), (res)=>{
				if(!res[0] && !canEditOthers){
					chat.js.reply(message, "You do not have any alts.");
				}else if(!res[1]){
					chat.js.reply(message, "That account has no alts.");
				}else if(res[0].id !== res[1].id && !canEditOthers){
					chat.js.reply(message, "That account is not one of your alts.");
				}else{
					changeMains(res[1].id, removeFormatting(removeRank(args[0])), ()=>{
						if(res[0].id !== res[1].id){
							chat.js.reply(message, "Their name was successfully changed.");
						}else{
							chat.js.reply(message, "Your name was successfully changed.");
						}
					}, (err)=>{
						error(JSON.stringify(err));
						if(res[0].id !== res[1].id){
							chat.js.reply(message, "There was an error while changing their main account name.");
						}else{
							chat.js.reply(message, "There was an error while changing your main account name.");
						}
					});
				}
			}, (err)=>{
				error(err);
				chat.js.reply(message, "Something went wrong when finding your main.");
			});
		}
	},
	removeformatting: function(message, args, rank){
		if(!auth.js.rankgeq(rank,"@")){
			chat.js.reply(message, "You rank isn't high enough to do that.");
		}else if (args.length < 1){
			chat.js.reply(message, "You need to give a player to fix.");
		}else{
			let id = toId(args[0]);
			pgclient.js.getId(id, false, (row)=>{
				if(!row){
					chat.js.reply(message, "That user does not have an entry.");
				}else{
					changeMains(row.id, id, ()=>{
						chat.js.reply(message, "Successfully reset the main mane.");
					}, (err)=>{
						error(err);
						chat.js.reply(message, "Something went wrong when updating the main.");
					});
				}
			}, (err)=>{
				error(err)
				chat.js.reply(message, "Something went wrong when finding the main account.");
			});
		}
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
	},
	//~timer [minutes], [seconds], {message}, {warning}, {room}
	timer: function(message, args){
		let room = (toId(args[0]) === "end" ? toRoomId(args[1]) : toRoomId(args[4])) || message.room;
		let rank = auth.js.getEffectiveRoomRank(message, room);
		let announcement = args[2] ? "/wall " + args[2] : "/wall Timer's up!";
		let duration=0, minutes=0, seconds=0, min, max;
		if(args[0] && /^\d+$/.test(args[0])){
			minutes = parseInt(args[0]);
		}else if(args[0] && /^\d+:\d+$/.test(args[0])){
			min = parseInt(args[0].split(":")[0]);
			max = parseInt(args[0].split(":")[1]);
			minutes = Math.floor(Math.random()*(max - min + 1)) + min;
		}
		if(args[1] && /^\d+$/.test(args[1])){
			seconds = parseInt(args[1]);
		}else if(args[1] && /^\d+:\d+$/.test(args[1])){
			min = parseInt(args[1].split(":")[0]);
			max = parseInt(args[1].split(":")[1]);
			seconds = Math.floor(Math.random()*(max - min + 1)) + min;
		}
		duration = minutes*60 + seconds;
		let warning = /^\d+$/.test(args[3]) ? parseInt(args[3]) : 0;
		if(!auth.js.rankgeq(rank, self.config.timerRank)){
			chat.js.reply(message, "Your rank is not high enough to manage timers.");
		}else if(!room){
			chat.js.reply(message, "You must specify a room.");
		}else if(toId(args[0]) === "end"){
			let timerName = "room:" + room;
			if(self.data.timers[timerName]){
				clearTimeout(self.data.timers[timerName].timer);
				if(self.data.timers[timerName].warning) clearTimeout(self.data.timers[timerName].warning);
				delete self.data.timers[timerName];
				chat.js.reply(message, "Successfully cleared the timer for " + room + ".");
			}else{
				chat.js.reply(message, "There isn't a timer for " + room + ".");
			}
		}else if(!duration){
			chat.js.reply(message, "You must give a time of at least one second.");
		}else if(warning >= duration){
			chat.js.reply(message, "The warning must be less than the duration.")
		}else{
			let timerName = "room:" + room;
			if(self.data.timers[timerName]){
				clearTimeout(self.data.timers[timerName].timer);
				delete self.data.timers[timerName];
			}
			self.data.timers[timerName] = {
				room: room,
				timer: setTimeout(()=>{
					delete self.data.timers[timerName];
					chat.js.say(room, announcement);
				}, duration*1000),
				warning: warning > 0 ? setTimeout(()=>{
					delete self.data.timers[timerName]["warning"];
					chat.js.say(room, warning + " seconds left!");
				}, (duration-warning)*1000) : null
			};
			chat.js.reply(message, "Set the timer for " + Math.floor(duration/60) + " minute(s) and " + (duration%60) + " second(s).");
		}
	},
	addfact: function(message, args, rank){
		if(auth.js.rankgeq(rank, self.config.factRank)){
			if(!args.length){
				chat.js.reply(message, "You need to give a fact to add.");
			}else{
				let fact = message.message.substr(9);
				let factId = toId(fact);
				if(self.data.facts.filter(f=>{return f.id == factId}).length){
					chat.js.reply(message, "That fact already exists.");
				}else{
					self.data.facts.add({text: fact, id: factId});
					saveFacts();
					chat.js.reply(message, "Successfully added the fact.");
				}
			}
		}else{
			chat.js.reply(message, "Your rank is not high enough to edit facts.");
		}
	},
	removefact: function(message, args, rank){
		if(auth.js.rankgeq(rank, self.config.factRank)){
			if(!args.length){
				chat.js.reply(message, "You need to give a fact to remove.");
			}else{
				let fact = args.join(", ");
				let factId = toId(fact);
				let num = self.data.facts.length;
				self.data.facts = self.data.facts.filter(f=>{return f.id !== factId});
				if(self.data.facts.length === num){
					chat.js.reply(message, "That fact does not exist.");
				}else{
					saveFacts();
					chat.js.reply(message, "Successfully removed the fact.");
				}
			}
		}else{
			chat.js.reply(message, "Your rank is not high enough to edit facts.");
		}
	},
	randfact: "fact",
	randomfact: "fact",
	fact: function(message, args, rank){
		if(self.data.facts.length){
			chat.js.strictReply(message, "__" + self.data.facts[Math.floor(Math.random()*self.data.facts.length)].text + "__");
		}else{
			chat.js.strictReply(message, "There are no facts :<");
		}
	},
	facts: "factlist",
	factlist: function(message, args, rank){
		if(!auth.js.rankgeq(rank, self.config.factRank)){
			chat.js.reply(message, "Your rank is not high enough to manage facts.");
		}else if(self.data.facts.length){
			let text = self.data.facts.map(f=>{return f.text}).join("\n\n");
			request.post({url:'https://hastebin.com/documents', body: text}, function(err,httpResponse,body){
				try{
					chat.js.pm(message.user, "Here is a list of all the facts: hastebin.com/" + JSON.parse(body).key);
				}catch(e){
					error(e.message);
					chat.js.reply(message, "Something was wrong with the response from hastebin.");
				}
			});
		}else{
			chat.js.reply(message, "There are no facts :<");
		}
	},
	minigamelist: function(message, args, rank){
		if(!auth.js.rankgeq(rank, self.config.batchRank)){
			chat.js.reply(message, "Your rank is not high enough to manage query batches.");
		}else if(true){
			let text = JSON.stringify(self.data.batches, null, "\t");
			request.post({url:'https://hastebin.com/documents', body: text}, function(err,httpResponse,body){
				try{
					chat.js.reply(message, "Here is a list of all the batches: hastebin.com/" + JSON.parse(body).key);
				}catch(e){
					error(e.message);
					chat.js.reply(message, "Something was wrong with the response from hastebin.");
				}
			});
		}else{
			chat.js.reply(message, "There are no query batches :<");
		}
	},
	minigameupdate: function(message, args, rank){
		let response = "oops";
		let success = false;
		if(!auth.js.rankgeq(rank, self.config.batchRank)){
			response = "Your rank is not high enough to manage query batches.";
		}else if(args.length < 1){
			response = "You must give a link to the query batches.";
		}else if(/^(https?:\/\/)?(www\.)?hastebin.com\/raw\/[a-z]+$/.test(args[0])){
			success = true;
			request.get(args[0],function(err, response, body){
				if(err){
						error(err);
						chat.js.reply(message, err);
						return;
				}
				try{
					self.data.batches = JSON.parse(body);
					saveBatches();
					chat.js.pm(message.user, "Updated the query batches.");
				}catch(e){
					error(e);
					chat.js.pm(message.user, "There was an error parsing the text in the hastebin link.");
				}
			});
		}else{
			response = "There was something wrong with your link, make sure it's only the raw paste.";
		}
		if(!success){
			chat.js.pm(message.user, response);
		}
	},
	minigame: function(message, args, rank){
		let command = toId(args[0]);
		let qbatch = self.data.batches[command];
		if(qbatch){
			if(auth.js.rankgeq(rank, qbatch.rank)){
				let queries = qbatch.queries.slice();
				let queryFunc = (queries)=>{
					if(queries.length){
						if(queries[0].substring(0,2) === '--'){
							let parts = queries.shift().substr(2).split(" ")
							if(parts.length === 1){
								delete self.data.flags[parts[0]]
							}else{
								self.data.flags[parts[0]] = parts[1]
							}
							queryFunc(queries);
						}else{
							pgclient.js.runSql(queries.shift(), null, null, ()=>{
								queryFunc(queries);
							}, (err)=>{
								error(err);
								chat.js.reply(message, "There was an error executing one of the queries.");
							});
						}
					}else{
						chat.js.reply(message, qbatch.response || "Successfully executed the queries.");
					}
				}
				queryFunc(queries);
			}else{
				chat.js.reply(message, "Your rank is not high enough to use that query batch.");
			}
		}else{
			chat.js.reply(message, "There's no query batch with that name.");
		}
	},
	voice: function(message, args, rank){
		let room = message.room;
		if(auth.js.rankgeq(rank, self.config.voicechatRank) && auth.js.rankgeq(auth.js.getTrueRoomRank(mainConfig.user, room), "@")){
			if(!self.data.tempVoices[room]) self.data.tempVoices[room] = {};
			for(let i=0;i<args.length;i++){
				let id = toId(args[i]);
				if(!self.data.tempVoices[room][id] && rooms.js.getDisplayName(id, room) && auth.js.getTrueRoomRank(id, room) === " "){
					self.data.tempVoices[room][id] = true;
					chat.js.say(room, "/roomvoice " + id);
				}
			}
			chat.js.say(room, "/modchat +");
		}
	},
	devoice: "dv",
	dv: function(message, args, rank){
		let room = message.room;
		if(auth.js.rankgeq(rank, self.config.voicechatRank) && auth.js.rankgeq(auth.js.getTrueRoomRank(mainConfig.user, room), "@")){
			for(let i=0;i<args.length;i++){
				let id = toId(args[i]);
				if(self.data.tempVoices[room][id]){
					delete self.data.tempVoices[room][id];
					chat.js.say(room, "/roomdeauth " + id);
				}
			}
		}
	},
	devoiceall: "dvall",
	dvall: function(message, args, rank){
		let room = message.room;
		if(auth.js.rankgeq(rank, self.config.voicechatRank) && auth.js.rankgeq(auth.js.getTrueRoomRank(mainConfig.user, room), "@")){
			if(self.data.tempVoices){
				for(let id in self.data.tempVoices[room]){
					delete self.data.tempVoices[room][id];
					chat.js.say(room, "/roomdeauth " + id);
				}
			}
			chat.js.say(room, "/modchat ac");
		}
	},
	info: "help",
	commands: "help",
	help: function(message, args){
		if(chat&&chat.js){
			chat.js.reply(message, "This page contains all the commands you need to know: https://github.com/CameronClarry/Showdown-Bot/blob/master/README.md");
		}
	},
	rules: function(message, args){
		if(chat&&chat.js){
			chat.js.reply(message, "Here's everything you need to know about Trivia Tracker: http://pstrivia.weebly.com/trivia-tracker.html");
		}
	},
	legacyrules: function(message, args){
		if(chat&&chat.js){
			chat.js.reply(message, "Here are the rules for questions: https://drive.google.com/file/d/0B6H5ZoTTDakRYTBNMzUtWUNndWs/view");
		}
	},
	intro: function(message, args, rank){
		chat.js.reply(message, "Here is a beginner's guide to Trivia Tracker (with pictures!): https://pstrivia.weebly.com/trivia-tracker.html#intro");
	},
	plug: function(message, args, rank){
		chat.js.reply(message, "https://plug.dj/trivia");
	},
	shuffle: function(message, args, rank){
		chat.js.reply(message, shuffle(args).join(", "))
	}
};

let ttCommands = {
	newgame: function(message, args, rank){
		let room = message.room;
		if(args.length > 1){
			room = toRoomId(args[1]);
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
				self.data.games[room] = {room: room, history:[], bpOpen: "auth"};
				chat.js.say(room,"**A new game of Trivia Tracker has started. Since " + message.user + " is not in the room for some reason, BP is now open.**");
			}

		}
	},
	endgame: function(message, args, rank){
		let room = message.room;
		if(args.length > 1){
			room = toRoomId(args[1]);
		}
		if(room === ""){
			chat.js.reply(message, "You must specify a room for the game.");
		}else if(!self.data.games[room]){
			chat.js.reply(message, "There is no game of Trivia Tracker in " + room + " to end.");
		}else if(!auth.js.rankgeq(rank, self.config.endGameRank)){
			chat.js.reply(message, "Your rank is not high enough to end the game of Trivia Tracker.");
		}else{
			clearTimers(self.data.games[room]);
			delete self.data.games[room];
			chat.js.say(room,"**The game of Trivia Tracker has ended.**");
		}
	}
};

let ttleaderboardCommands = {
	list: function(message, args, rank){
		let lb = args[2] || "main";
		let number = 5;
		if(args[1] && /^[\d]+$/.test(args[1])){
			number = parseInt(args[1], 10);
		}
		let rows = [];
		rank = auth.js.getEffectiveRoomRank(message, message.room);
		listLeaderboardEntries([number, lb], (row)=>{
			rows.push(row);
		},()=>{
			if(!rows.length){
				chat.js.strictReply(message, "There are no players on the " + lb + " leaderboard.");
			}else{
				if(args[3] &&  auth.js.rankgeq(rank, "%")){
					sayScores(rows, lb, message.room);
				}else{
					chat.js.strictReply(message, "The top " + rows.length + " score" + (rows.length === 1 ? "" : "s") + " in the " + lb + " leaderboard " + (rows.length === 1 ? "is" : "are") + ": " + rows.map((row)=>{return "__" + (row.display_name || row.id1) + "__: " + row.points}).join(", ") + ".");
				}
			}
		},(err)=>{
			error(err);
			chat.js.strictReply(message, "There was either an error fetching the scores or the leaderboard you entered does not exist.");
		});
	},
	listall: function(message, args, rank){
		let lb = toId(args[1]) || "main";
		let rows = [];
		if(!auth.js.rankgeq(rank, "#")){
			return;
		}
		pgclient.js.runSql(LIST_ALL_LB_ENTRIES_SQL, [lb], (row)=>{
			rows.push(row);
		},()=>{
			if(!rows.length){
				chat.js.strictReply(message, "There are no players on the " + lb + " leaderboard.");
			}else{
				let text = "Listed here all players with a score of at least 1 on the " + lb + " leaderboard.\n";
				text = text + "\n" + rows.map((row)=>{return (row.display_name || row.id1) + ": " + row.points}).join("\n")
				request.post({url:'https://hastebin.com/documents', body: text}, function(err,httpResponse,body){
					try{
						chat.js.strictReply(message, "Here is the full leaderboard: hastebin.com/" + JSON.parse(body).key);
					}catch(e){
						error(e.message);
						chat.js.strictReply(message, "Something went wrong with the response from hastebin.");
					}
				});
			}
		},(err)=>{
			error(err);
			chat.js.strictReply(message, "There was either an error fetching the scores or the leaderboard you entered does not exist.");
		});
	},
	check: function(message, args, rank){
		let user = args[1] || message.user;
		let lb = toId(args[2]) || "main";
		let lbExists = false;
		let lbname = "";
		pgclient.js.runSql(GET_ALL_LB_SQL, [], (row)=>{
			if(row.id === lb){
				lbExists = true;
				lbname = row.display_name;
			}
		}, ()=>{
			if(!lbExists){
				chat.js.strictReply(message, "The leaderboard you entered does not exist.");
			}else{
				let res;
				pgclient.js.getId(user, false, (res)=>{
					if(!res){
						chat.js.strictReply(message, user + " does not have a score on the " + lbname + " leaderboard.");
					}else{
						getLeaderboardEntry([res.id, lb], (entry)=>{
							if(!entry){
								chat.js.strictReply(message, res.display_name + " does not have a score on the " + lbname + " leaderboard.");
							}else{
								chat.js.strictReply(message, res.display_name + "'s score on the " + lbname + " leaderboard is " + entry.points + ".");
							}
						},(err)=>{
							error(err);
							chat.js.strictReply(message, "There was an error fetching the score for " + res.display_name + ".");
						});
					}
				}, (err)=>{
					error(err);
					chat.js.strictReply(message, "There was an error getting " + user + "'s id.");
				});
			}
		}, (err)=>{
			error(err);
			chat.js.strictReply(message, "There was an error getting the leaderboard list.");
		});


	},
	//Number of people, your place, your score, points to next place
	summary: function(message, args, rank){
		let lb = toId(args[1]) || "main";
		let id = toId(message.user);
		let lbExists = false;
		let lbname = "";
		pgclient.js.runSql(GET_ALL_LB_SQL, [], (lbRow)=>{
			if(lbRow.id === lb){
				lbExists = true;
				lbname = lbRow.display_name;
			}
		}, ()=>{
			if(!lbExists){
				chat.js.reply(message, "The leaderboard you entered does not exist.");
			}else{
				let res;
				pgclient.js.getId(id, false, (res)=>{
					if(!res){
						chat.js.reply(message, "You do not have a score on the " + lbname + " leaderboard.");
					}else{
						getLeaderboardEntry([res.id, lb], (entry)=>{
							if(!entry){
								chat.js.reply(message, "You do not have a score on the " + lbname + " leaderboard.");
							}else{
								let score = entry.points;
								let entries = [];
								pgclient.js.runSql(GET_ALL_LB_ENTRIES_SQL, [lb], (row)=>{
									entries.push(row)
								}, (res2)=>{
									if(entries.length === 0){
										chat.js.reply(message, "There doesn't seem to be anyone on the leaderboard. Maybe something went wrong.");
									}else if(entries.length === 1){
										chat.js.reply(message, "You are the only person on the leaderboard (and your score is " + score + ").");
									}else{
										if(entries[0].points === score){
											let nextPlayer = idsMatch(entries[0].display_name, res.display_name) ? entries[1] : entries[0];
											chat.js.reply(message, "You are first on the leaderboard with " + entries[0].points + " points. Second place is __" + nextPlayer.display_name + "__ with " + entries[1].points + " points.");
										}else{
											let higherEntries = entries.filter(item=>{return item.points > score});
											let response = "First place is __" + entries[0].display_name + "__ with " + entries[0].points + " points.";
											response += " Your rank is " + (higherEntries.length+1) + " with " + score + " points.";
											response += " The next player above you is __" + higherEntries[higherEntries.length - 1].display_name + "__ with " + higherEntries[higherEntries.length - 1].points + " points.";
											chat.js.reply(message, response);
										}
									}
								}, (err)=>{
									error(err);
									chat.js.reply(message, "There was an error while getting the scores.");
								});
							}
						},(err)=>{
							error(err);
							chat.js.reply(message, "There was an error fetching the score for " + res.display_name + ".");
						});
					}
				}, (err)=>{
					error(err);
					chat.js.reply(message, "There was an error getting " + user + "'s id.");
				});
			}
		}, (err)=>{
			error(err);
			chat.js.reply(message, "There was an error getting the leaderboard list.");
		});
	},
	stats: function(message, args, rank){

		let lb = toId(args[1]) || "main";
		let avg, std, num, lbname;
		let lbExists = false;

		pgclient.js.runSql(GET_ALL_LB_SQL, [], (row)=>{
			if(row.id === lb){
				lbExists = true;
				lbname = row.display_name;
			}
		}, ()=>{
			if(!lbExists){
				chat.js.reply(message, "That leaderboard doesn't exist.");
			}else{
				pgclient.js.runSql(GET_NUM_PLAYERS, [lb], (row)=>{
					num = parseInt(row.num_players);
				}, ()=>{
					if(num === 0){
						chat.js.reply(message, "There are no players on that leaderboard.");
					}else{
						pgclient.js.runSql(GET_STD_POINTS, [lb], (row)=>{
							std = Math.round(row.std_points*100)/100;
						}, ()=>{
							pgclient.js.runSql(GET_AVG_POINTS, [lb], (row)=>{
								avg = Math.round(row.avg_points*10)/10;
							}, ()=>{
								chat.js.reply(message, "There are " + num + " players on the " + lbname + " leaderboard. The average score is " + avg + " and the standard deviation is " + std + ".");
							}, (err)=>{
								error(err);
								chat.js.reply(message, "There was an error getting the leaderboard information.");
							});
						}, (err)=>{
							error(err);
							chat.js.reply(message, "There was an error getting the leaderboard information.");
						});
					}
				}, (err)=>{
					error(err);
					chat.js.reply(message, "There was an error getting the leaderboard information.");
				});

			}
		}, (err)=>{
			error(err);
			chat.js.reply(message, "There was an error getting the leaderboard list.");
		});
	},
	set: function(message, args, rank){
		if(!auth.js.rankgeq(rank, self.config.editScoreRank)){
			chat.js.reply(message, "Your rank is not high enough to change someone's score.");
		}else	if(args.length<=2 || !toId(args[1])){
			chat.js.reply(message, "You must specify the user's name, and the number of points to add.");
		}else if(!/^[\d]+$/.test(args[2])){
			chat.js.reply(message, "Invalid number format for the number of points.");
		}else{
			let user = args[1];
			let points = parseInt(args[2], 10);
			let lb = toId(args[3]) || "main"
			let lbname = "";
			let lbExists = false;
			pgclient.js.runSql(GET_ALL_LB_SQL, [], (row)=>{
				if(row.id === lb){
					lbExists = true;
					lbname = row.display_name;
				}
			}, ()=>{
				if(!lbExists){
					chat.js.reply(message, "That leaderboard doesn't exist.");
				}else{
					updateLeaderboardEntryByUsername([user, lb], (oldPoints)=>{
						return points;
					}, (res, newPoints)=>{
						if(!res){
							chat.js.reply(message, "Created a new " + lbname + " leaderboard entry for " + user + " and set their score to " + newPoints + ".");
						}else{
							chat.js.reply(message, "Updated the score for " + res.display_name + ". Their " + lbname + " leaderboard score changed from " + res.points + " to " + newPoints + ".");
						}
					}, (err)=>{
						error(err);
						chat.js.reply(message, "There was an error updating the score.");
					});
				}
			}, (err)=>{
				error(err);
				chat.js.reply(message, "There was an error getting the leaderboard list.");
			})
		}
	},
	add: function(message, args, rank){
		if(!auth.js.rankgeq(rank, self.config.editScoreRank)){
			chat.js.reply(message, "Your rank is not high enough to change someone's score.");
		}else	if(args.length<=2 || !toId(args[1])){
			chat.js.reply(message, "You must specify the user's name, and the number of points to add.");
		}else if(!/^-?[\d]+$/.test(args[2])){
			chat.js.reply(message, "Invalid number format for the number of points.");
		}else{
			let user = args[1];
			let points = parseInt(args[2], 10);
			let eventFilter = args[3] ? (e)=>{return idsMatch(args[3], e)} : null;
			updateAllLeaderboardEntriesByUsername(user, (oldPoints)=>{
				return Math.max(oldPoints + points, 0);
			}, (name, affected, failed)=>{
				let response = "Updated " + affected + " scores for " + name + ".";
				if(failed.length){
					response += " The following leaderboards failed to update: " + failed.join(", ") + ".";
				}
				chat.js.reply(message, response);
			}, (err)=>{
				error(err);
				chat.js.reply(message, "There was an error updating the scores.");
			}, eventFilter);
		}
	},
	addto: function(message, args, rank){
		if(!auth.js.rankgeq(rank, self.config.editScoreRank)){
			chat.js.reply(message, "Your rank is not high enough to change someone's score.");
		}else	if(args.length<4 || !toId(args[1])){
			chat.js.reply(message, "You must specify the user's name, the number of points to add, and the leaderboard.");
		}else if(!/^-?[\d]+$/.test(args[2])){
			chat.js.reply(message, "Invalid number format for the number of points.");
		}else{
			let user = args[1];
			let points = parseInt(args[2], 10);
			let lb = toId(args[3])
			let lbname = "";
			let lbExists = false;
			if(!lb){
				chat.js.reply(message, "You must give a valid leaderboard.")
			}
			pgclient.js.runSql(GET_ALL_LB_SQL, [], (row)=>{
				if(row.id === lb){
					lbExists = true;
					lbname = row.display_name;
				}
			}, ()=>{
				if(!lbExists){
					chat.js.reply(message, "That leaderboard doesn't exist.");
				}else{
					updateLeaderboardEntryByUsername([user, lb], (oldPoints)=>{
						return oldPoints + points;
					}, (res, newPoints)=>{
						if(!res){
							chat.js.reply(message, "Created a new " + lbname + " leaderboard entry for " + user + " and set their score to " + newPoints + ".");
						}else{
							chat.js.reply(message, "Updated the score for " + res.display_name + ". Their " + lbname + " leaderboard score changed from " + res.points + " to " + newPoints + ".");
						}
					}, (err)=>{
						error(err);
						chat.js.reply(message, "There was an error updating the score.");
					});
				}
			}, (err)=>{
				error(err);
				chat.js.reply(message, "There was an error getting the leaderboard list.");
			})
		}
	},
	remove: function(message, args, rank){
		if(!toId(args[1])){
			chat.js.reply(message, "You must specify a user.");
		}else if(!auth.js.rankgeq(rank, self.config.editScoreRank)){
			chat.js.reply(message, "Your rank is not high enough to remove someone's leaderboard entries.");
		}else{
			pgclient.js.getId(args[1], false, (user)=>{
				if(!user){
					chat.js.reply(message, args[1] + " does not have any leaderboard entries.");
				}else{
					removeAllLeaderboardEntries(user.id, (res)=>{
						chat.js.reply(message, "Removed " + res.rowCount + " leaderboard entries for " +	args[1] + ".");
					}, ()=>{}, (err)=>{
						error(err);
						chat.js.reply(message, "There was an error removing the entries.");
					});
				}
			}, (err)=>{
				error(err);
				chat.js.reply(message, "There was an error while getting " + args[1] + "'s id.");
			});
		}
	},
	reset: function(message, args, rank){
		let leaderboard = self.data.leaderboard;
		if(!auth.js.rankgeq(rank, self.config.resetLeaderboardRank)){
			chat.js.reply(message, "Your rank is not high enough to reset the leaderboard.");
		}else{
			if(idsMatch(message.user, self.data.askToReset)){
				try{
					let child = spawn("pg_dump", [mainConfig.dbname]);
					let parts = [];
					child.stdout.on("data", (data)=>{
						parts.push(data);
					});
					child.on('error', (err)=>{
						error("There was an error with the subprocess.");
						chat.js.reply(message, "There was an error with the subprocess responsible for creating the database dump.");
					});
					child.on("exit", (code, signal)=>{
						let text = parts.join("");
						let filename = "backups/" + new Date().toISOString() + ".dump";
						fs.writeFile(filename, text, (err)=>{
							// Now that the database has been written, it's okay to reset
							getAllLeaderboardEntries("main", (arr)=>{
								pgclient.js.getId(message.user, true, (user)=>{
									pgclient.js.runSql(DELETE_LB_ENTRIES_SQL, ["main"], null, (res)=>{
										pgclient.js.runSql(RESET_MAIN_LB_SQL, [user.id], null, ()=>{
											chat.js.reply(message, "Successfully deleted " + res.rowCount + " score(s) from the main leaderboard.");
											self.data.askToReset = "";
											achievementsOnReset("main", arr);
										}, (err)=>{
											error(err);
											chat.js.reply(message, "There was an updating the leaderboard info.");
										})
									}, (err)=>{
										error(err)
										chat.js.reply(message, "There was an error while removing the leaderboard.");
									});
								}, (err)=>{
									error(err);
									chat.js.reply(message, "There was an error while getting your id.");
								});
							});
						});
					});
				}catch(e){
					error(e.message);
					chat.js.reply(message, "There was an error creating the subprocess responsible for creating the database dump.");
				}

			}else{
				self.data.askToReset = message.user;
				chat.js.reply(message, "Are you sure you want to reset the leaderboard? (Enter the reset command again to confirm)");
			}
		}
	}
};

let ttleaderboardEventCommands = {
	list: function(message, args, rank){
		let events = [];
		pgclient.js.runSql(GET_ALL_LB_SQL, [], (row)=>{
			events.push(row);
		}, ()=>{
			if(!events.length){
				chat.js.reply(message, "There are no leaderboards right now.");
			}else{
				chat.js.reply(message, "These are the current leaderboards: " + events.map((event)=>{return event.display_name}).join(", "));
			}
		}, (err)=>{
			error(err);
			chat.js.reply(message, "There was an error fetching the leaderboards.");
		});
	},
	add: function(message, args, rank){
		if(!auth.js.rankgeq(rank, self.config.manageEventRank)){
			chat.js.reply(message, "Your rank is not high enough to create a leaderboard.");
		}else if(args.length<=1 || !toId(args[1])){
			chat.js.reply(message, "You must specify the name for the leaderboard.");
		}else if(args[1].length > 20){
			chat.js.reply(message, "That name is too long.");
		}else{
			let displayName = args[1];
			let lb;
			pgclient.js.runSql(GET_LB_SQL, [toId(displayName)], (row)=>{
				lb = row;
			}, ()=>{
				if(lb){
					chat.js.reply(message, "A leaderboard already exists with the same name.");
				}else{
					pgclient.js.getId(message.user, true, (res)=>{
						pgclient.js.runSql(INSERT_LB_SQL, [toId(displayName), displayName, res.id], null, ()=>{
								chat.js.reply(message, "Successfully created a new leaderboard.");
						}, (err)=>{
							error(err)
							chat.js.reply(message, "There was an error while creating the new leaderboard.");
						});
					}, (err)=>{
						error(err);
						chat.js.reply(message, "There was a problem getting your id.");
					});
				}
			}, (err)=>{
				error(err);
				chat.js.reply(message, "Something went wrong when trying to fetch the leaderboard list.");
			});
		}
	},
	remove: function(message, args, rank){
		if(!auth.js.rankgeq(rank, self.config.manageEventRank)){
			chat.js.reply(message, "Your rank is not high enough to remove a leaderboard.");
		}else if(args.length<=1){
			chat.js.reply(message, "You must specify the name for the leaderboard.");
		}else if(toId(args[1]) === "main"){
			chat.js.reply(message, "You cannot remove that leaderboard.");
		}else{
			let id = toId(args[1]);
			let lb;
			pgclient.js.runSql(GET_LB_SQL, [id], (row)=>{
				lb = row;
			}, ()=>{
				if(!lb){
					chat.js.reply(message, "There is no leaderboard with that name.");
				}else{
					pgclient.js.runSql(DELETE_LB_ENTRIES_SQL, [id], null, (res)=>{
						pgclient.js.runSql(DELETE_LB_SQL, [id], null, ()=>{
							chat.js.reply(message, "Successfully removed the leaderboard and deleted " + res.rowCount + " score(s).");
						}, (err)=>{
							error(err)
							chat.js.reply(message, "There was an error while removing the leaderboard.");
						});
					}, (err)=>{
						error(err)
						chat.js.reply(message, "There was an error while removing the leaderboard.");
					});
				}
			}, (err)=>{
				error(err);
				chat.js.reply(message, "Something went wrong when trying to fetch the leaderboard list.");
			});
		}
	},
	info: function(message, args, rank){
		let lbName = args[1] || "main";
		let id = toId(lbName);
		let lb;
		pgclient.js.runSql(GET_LB_SQL, [id], (row)=>{
			lb = row;
		}, ()=>{
			if(!lb){
				chat.js.reply(message, "There is no leaderboard with the name " + lbName + ".");
			}else if(id !== "main"){
				chat.js.reply(message, "Leaderboard name: " + lb.display_name + ", created on: " + lb.created_on.toUTCString() + ", created by: " + lb.created_by + ", enabled: " + lb.enabled);
			}else{
				chat.js.reply(message, "Leaderboard name: " + lb.display_name + ", last reset: " + lb.created_on.toUTCString() + ", reset by: " + lb.created_by + ", enabled: " + lb.enabled);
			}
		}, (err)=>{
			error(err);
			chat.js.reply(message, "Something went wrong when trying to fetch the leaderboard.");
		});
	},
	enable: function(message, args, rank){
		if(!auth.js.rankgeq(rank, self.config.manageEventRank)){
			chat.js.reply(message, "Your rank is not high enough to enable a leaderboard.");
		}else if(args.length<2){
			chat.js.reply(message, "You must specify the name for the leaderboard.");
		}else{
			let id = toId(args[1]);
			let lbs = {};
			pgclient.js.runSql(GET_ALL_LB_SQL, [], (row)=>{
				lbs[row.id] = row;
			}, (res)=>{
				if(!lbs[id]){
					chat.js.reply(message, "The leaderboard you specified doesn't exist.");
				}else if(lbs[id].enabled){
					chat.js.reply(message, "That leaderboard is already enabled.");
				}else{
					pgclient.js.runSql(UPDATE_LB_SQL, [id, true], null, (res)=>{
						chat.js.reply(message, "Successfully enabled the " + lbs[id].display_name + " leaderboard.");
					}, (err)=>{
						error(err);
						chat.js.reply(message, "There was an error while updating the leaderboard.");
					})
				}
			}, (err)=>{
				error(err);
				chat.js.reply("There was an error when retrieving the leaderboards.");
			});
		}
	},
	disable: function(message, args, rank){
		if(!auth.js.rankgeq(rank, self.config.manageEventRank)){
			chat.js.reply(message, "Your rank is not high enough to disable a leaderboard.");
		}else if(args.length<2){
			chat.js.reply(message, "You must specify the name for the leaderboard.");
		}else{
			let id = toId(args[1]);
			let lbs = {};
			pgclient.js.runSql(GET_ALL_LB_SQL, [], (row)=>{
				lbs[row.id] = row;
			}, (res)=>{
				if(!lbs[id]){
					chat.js.reply(message, "The leaderboard you specified doesn't exist.");
				}else if(!lbs[id].enabled){
					chat.js.reply(message, "That leaderboard is already disabled.");
				}else{
					pgclient.js.runSql(UPDATE_LB_SQL, [id, false], null, (res)=>{
						chat.js.reply(message, "Successfully disabled the " + lbs[id].display_name + " leaderboard.");
					}, (err)=>{
						error(err);
						chat.js.reply(message, "There was an error while updating the leaderboard.");
					})
				}
			}, (err)=>{
				error(err);
				chat.js.reply("There was an error when retrieving the leaderboards.");
			});
		}
	}
};

let blacklistCommands = {
	add: function(message, username, id, duration, reason){
		let entry = getBlacklistEntry(id);
		if(entry){
			chat.js.reply(message, "The user " + entry.displayName + " is already on the blacklist.");
		}else if(duration){
			self.data.leaderboard.blacklist[id] = {displayName: username, reason: reason, duration: duration*60000, time: Date.now()};
			chat.js.reply(message, "Added " + username + " to the blacklist for " + millisToTime(duration*60000) + ".");
			chat.js.say("trivia", "/modnote " + username + " was added to the Trivia Tracker blacklist by " + message.user + " for " + millisToTime(duration*60000) + ". (" + reason + ")");
		}else{
			self.data.leaderboard.blacklist[id] = {displayName: username, reason: reason, duration: duration*60000, time: Date.now()};
			chat.js.reply(message, "Added " + username + " to the blacklist permanently.");
			chat.js.say("trivia", "/modnote " + username + " was added to the Trivia Tracker blacklist permanently by " + message.user + ". (" + reason + ")");
		}
		saveLeaderboard();
	},
	remove: function(message, username, id, duration, reason){
		let entry = getBlacklistEntry(id);
		if(!entry){
			chat.js.reply(message, "The user " + username + " is not on the blacklist.");
		}else{
			delete self.data.leaderboard.blacklist[id];
			chat.js.reply(message, "Removed " + entry.displayName + " from the blacklist.");
			chat.js.say("trivia","/modnote " + entry.displayName + " was removed from the Trivia Tracker blacklist by " + message.user);
			saveLeaderboard();
		}
	},
	check: function(message, username, id, duration, reason){
		let entry = getBlacklistEntry(id);
		if(entry && !entry.duration){
			chat.js.reply(message, "The user " + entry.displayName + " is permantently on the blacklist. Reason: " + entry.reason + ".");
		}else if(entry){
			chat.js.reply(message, "The user " + entry.displayName + " is on the blacklist for " + millisToTime(entry.duration - Date.now() + entry.time) + ". Reason: " + entry.reason + ".");
		}else{
			chat.js.reply(message, "The user " + username + " is not on the blacklist.");
		}
	},
	unmute:function(message, username, id, duration, reason){
		let entry = getBlacklistEntry(id);
		if(!entry){
			chat.js.reply(message, "The user " + username + " is not on the blacklist.");
		}else if(!entry.duration || entry.duration > 60*60000){
			chat.js.reply(message, "That user is blacklisted for longer than a mute.");
		}else{
			delete self.data.leaderboard.blacklist[id];
			chat.js.reply(message, "Removed " + entry.displayName + " from the blacklist.");
			chat.js.say("trivia","/modnote " + entry.displayName + " was removed from the Trivia Tracker blacklist by " + message.user);
			saveLeaderboard();
		}
	}
};

let tryBatonPass = function(room, nextPlayer, historyToAdd, shouldUndo, remindTime, wasClaimed){
	remindTime = remindTime || self.config.remindTime;
	let game = self.data.games[room];
	let result = false;
	let response = "There is no game of Trivia Tracker in " + room + ".";
	if(game){
		let history = game.history;
		let displayName = rooms.js.getDisplayName(nextPlayer, room);
		if(displayName === null){
			response = "The user " + nextPlayer + " is not in the room " + room + ".";
		}else if(idsMatch(nextPlayer, history[history.length-1].active)){
			response = "It is already " + displayName + "'s turn to ask a question.";
		}else if(displayName[0] === "‽" || displayName[0] === "!"){
			response = "The user " + nextPlayer + " is either muted or locked.";
		}else if(getBlacklistEntry(toId(nextPlayer))){
			response = displayName + " is on the blacklist.";
		}else if(displayName !== null){
			let lastHist = history[history.length-1];
			if(shouldUndo){
				if(typeof lastHist.undo === "function"){
					lastHist.undo();
					lastHist.undo = null;
				}
			}
			if(wasClaimed){
				updateAllLeaderboardEntriesByUsername(nextPlayer, (oldPoints)=>{
					return Math.max(oldPoints + self.config.claimPoints, 0);
				});
				historyToAdd = {active:nextPlayer, undo:function(){
					updateAllLeaderboardEntriesByUsername(nextPlayer, (oldPoints)=>{
						return Math.max(oldPoints - self.config.claimPoints, 0);
					});
				}}
			}
			game.history.add(historyToAdd);
			if(history.length>10){
				history.shift();
			}
			result = true;
			game.bpOpen = null;
			clearTimers(game);
			game.remindTimer = setTimeout(()=>{
				onRemind(game);
			}, remindTime*1000);

			response = "**It is now " + displayName + "'s turn to ask a question.**";
			if(shouldUndo){
				response = response + " __" + lastHist.active + "__ lost any points they gained last turn because BP was opened."
			}
		}
	}
	return {result: result, response: response};
};

let sayScores = function(scores, lb, room){
	let message = "/addhtmlbox <table style=\"background-color: #45cc51; margin: 2px 0;border: 2px solid #0d4916;color: black\" border=1><tr style=\"background-color: #209331\"><th colspan=\"2\">" + lb + "</th></tr><tr style=\"background-color: #209331\"><th style=\"width: 150px\">User</th><th>Score</th></tr>";
	for(let i=0;i<scores.length;i++){
		message = message + "<tr><td>" + (scores[i].display_name || scores[i].id1) + "</td><td>" + scores[i].points + "</td></tr>";
	}
	message = message + "</table>"

	chat.js.say(room, message);
}

let onRemind = function(game){
	let history = game.history;
	if(history && history.length){
		if(!game.bpOpen){
			chat.js.pm(history[history.length-1].active, "You have " + (self.config.openTime) + " seconds to ask a question.");
		}
		let rank = auth.js.getRoomRank(history[history.length-1].active, "trivia");
		if(!auth.js.rankgeq(rank, self.config.manageBpRank)){
			game.openTimer = setTimeout(()=>{
				onTimeUp(game);
			},self.config.openTime*1000);
		}
	}
};

let onTimeUp = function(game){
	if(!game.bpOpen){
		chat.js.say(game.room, "**BP is now open (say 'me' or 'bp' to claim it).**");
		game.bpOpen = "timer";
	}else if(game.bpOpen == "leave" || game.bpOpen == "user"){
		game.bpOpen = "timer";
	}
	clearTimers(game);
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

let getBlacklistEntry = function(username){
	let leaderboard = self.data.leaderboard;
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

let addPlayers = function(names){
	if(names.length==0) return "Player list not updated. You must give at least one player.";
	if(!self.data.plist) self.data.plist = [];
	let plist = self.data.plist;
	for(let i=0;i<names.length;i++){
		let id = toId(names[i]);
		if(id==="") break;
		for(let j=0;j<plist.length+1;j++){
			if(j == plist.length){
				plist.push({id: id, displayName: names[i]});
				break;
			}else if(id == plist[j].id){
				break;
			}
		}
	}
	let n = plist.length;
	return "Player list updated. There " + (n==1?"is":"are") + " now " + n + " player" + (n==1?"":"s") + "."
}

let removePlayers = function(names){
	if(names.length==0) return "Player list not updated. You must give at least one player.";
	if(!self.data.plist) self.data.plist = [];
	for(let i=0;i<names.length;i++){
		let id = toId(names[i]);
		self.data.plist = self.data.plist.filter(item=>{return item.id !== id});
	}
	let n = self.data.plist.length;
	return "Player list updated. There " + (n==1?"is":"are") + " now " + n + " player" + (n==1?"":"s") + "."
}

let saveLeaderboard = function(){
	let path = "data/leaderboard.json";
	//let file = fs.openSync(path,'w');
	fs.writeFile(path,JSON.stringify(self.data.leaderboard, null, "\t"), function(){
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
		self.data.leaderboard = leaderboard;
		saveLeaderboard();
	}else{
		self.data.leaderboard = {blacklist:{}};
		saveLeaderboard();
	}
};

let saveFacts = function(){
	try{
		let filename = "data/facts.json";
		let factsFile = fs.openSync(filename,"w");
		fs.writeSync(factsFile,JSON.stringify(self.data.facts, null, "\t"));
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
			self.data.facts = JSON.parse(fs.readFileSync(filename, "utf8"));
			result = "Found and loaded the facts.";
		}else{
			self.data.facts = [];
			let factsFile = fs.openSync(filename,"w");
			fs.writeSync(factsFile,JSON.stringify(self.data.facts, null, "\t"));
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
		fs.writeSync(batchFile,JSON.stringify(self.data.batches, null, "\t"));
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
			self.data.batches = JSON.parse(fs.readFileSync(filename, "utf8"));
			result = "Found and loaded the facts.";
		}else{
			self.data.batches = [];
			let batchFile = fs.openSync(filename,"w");
			fs.writeSync(batchFile,JSON.stringify(self.data.batches, null, "\t"));
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
	if(scores.length > 0 && leaderboard === "main" && achievements && achievements.js){ // Awarding achievements
		let firstPlace = scores.filter((e)=>{return e.points === scores[0].points});
		for(let i=0;i<firstPlace.length;i++){
			achievements.js.awardAchievement(firstPlace[i].display_name, "Hatmor", (p,a)=>{});
		}
		let num = firstPlace.length;
		while(num<5 && num < scores.length){ // Using black magic to find all players in the top 5
			num += scores.filter((e)=>{return e.points === scores[num].points}).length;
		}
		let top5 = scores.slice(firstPlace.length, num);
		for(let i=0;i<top5.length;i++){
			achievements.js.awardAchievement(top5[i].display_name, "Elite", (p,a)=>{});
		}
		let message = "Congratulations to " + prettyList(firstPlace.map((e)=>{return e.display_name})) + " for getting first";
		if(top5.length){
			message += ", and to " + prettyList(top5.map((e)=>{return e.display_name})) + " for being in the top five!";
		}else{
			message += "!"
		}
		chat.js.say(GOVERNING_ROOM, message)
		if(num === 5 && scores.length > 5){
			let consolation = scores.filter((e)=>{return e.points === scores[5].points});
			for(let i=0;i<consolation.length;i++){
				achievements.js.awardAchievement(consolation[i].display_name, "Consolation Prize", (p,a)=>{
					chat.js.say(GOVERNING_ROOM, p + " has earned the achievement '" + a + "'!");
				});
			}
		}
	}
}

let achievementsOnScoreUpdate = function(user, leaderboard, oldScore, newScore){
	if(leaderboard === "main" && achievements && achievements.js){
		if(oldScore<250 && newScore >= 250){
			achievements.js.awardAchievement(user, "Super", (p,a)=>{
				chat.js.say(GOVERNING_ROOM, p + " has earned the achievement '" + a + "'!");
			});
		}
		if(oldScore<500 && newScore >= 500){
			achievements.js.awardAchievement(user, "Mega", (p,a)=>{
				chat.js.say(GOVERNING_ROOM, p + " has earned the achievement '" + a + "'!");
			});
		}
		if(oldScore<750 && newScore >= 750){
			achievements.js.awardAchievement(user, "Ultra", (p,a)=>{
				chat.js.say(GOVERNING_ROOM, p + " has earned the achievement '" + a + "'!");
			});
		}
		if(oldScore<1000 && newScore >= 1000){
			achievements.js.awardAchievement(user, "Hyper", (p,a)=>{
				chat.js.say(GOVERNING_ROOM, p + " has earned the achievement '" + a + "'!");
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
	correctPoints: 2,
	claimPoints: 1
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
	correctPoints: "int",
	claimPoints: "int"
};

exports.configTypes = configTypes;
