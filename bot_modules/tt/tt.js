let fs = require("fs");
let self = {js:{},data:{},requiredBy:[],hooks:{},config:{}};
let chat = null;
let auth = null;
let rooms = null;
let pg = require("pg");
const conInfo = {
      user: mainConfig.dbuser,
      password: mainConfig.dbpassword,
      database: mainConfig.dbname,
      host: mainConfig.dbhost,
      port: mainConfig.dbport
};

const INSERT_USER_SQL = "INSERT INTO users (username, display_name) VALUES ($1, $2);";
const DELETE_USER_SQL = "DELETE FROM users WHERE id = $1;";
const INSERT_ALT_SQL = "INSERT INTO alts (username, main_id) VALUES ($1, (SELECT id FROM users WHERE username = $2 FETCH FIRST 1 ROWS ONLY));";
const DELETE_ALT_SQL = "DELETE FROM alts WHERE username = $1;";
const GET_USER_SQL = "SELECT users.id, users.username, users.display_name FROM alts INNER JOIN users ON alts.main_id = users.id WHERE alts.username = $1 FETCH FIRST 1 ROWS ONLY;";
const GET_ALTS_SQL = "SELECT username FROM alts WHERE main_id = $1;";
const UPDATE_USER_SQL = "UPDATE users SET display_name = $2 WHERE id = $1;";
const UPDATE_MAINS_SQL = "UPDATE alts SET main_id = $2 WHERE main_id = $1;";
const GET_MAINS_SQL = "SELECT alts.username, id, display_name, TRUE AS is_first FROM alts INNER JOIN users ON alts.main_id = users.id WHERE alts.username = $1 UNION SELECT username, id, display_name, FALSE AS is_first FROM alts INNER JOIN users ON alts.main_id = users.id WHERE username = $2;";

const INSERT_LB_SQL = "INSERT INTO tt_leaderboards VALUES($1, $2, CURRENT_TIMESTAMP, $3, true);";
const DELETE_LB_SQL = "DELETE FROM tt_leaderboards WHERE id = $1;";
const GET_LB_SQL = "SELECT lb.id, lb.display_name, lb.created_on, users.display_name AS created_by, lb.enabled FROM tt_leaderboards AS lb LEFT OUTER JOIN users ON lb.created_by = users.id WHERE lb.id = $1;";
const GET_ALL_LB_SQL = "SELECT * FROM tt_leaderboards;";
const GET_ENABLED_LB_SQL = "SELECT * FROM tt_leaderboards WHERE enabled = TRUE;";
const RESET_MAIN_LB_SQL = "UPDATE tt_leaderboards SET created_on = CURRENT_TIMESTAMP, created_by = $1 WHERE id = 'main';";
const UPDATE_LB_SQL = "UPDATE tt_leaderboards SET enabled = $2 WHERE id = $1;";

const GET_LB_ENTRY_SQL = "SELECT lb.points, users.display_name FROM tt_points AS lb LEFT OUTER JOIN users ON lb.id = users.id WHERE lb.id = $1 AND lb.leaderboard = $2;";
const GET_LB_ENTRIES_SQL = "SELECT lb.points, users.display_name, lb.leaderboard FROM tt_points AS lb INNER JOIN users ON lb.id = USERS.id WHERE lb.id = $1;";
const LIST_LB_ENTRIES_SQL = "SELECT lb.points, users.display_name FROM tt_points AS lb LEFT OUTER JOIN users ON lb.id = users.id WHERE leaderboard = $1 AND lb.points > 0 ORDER BY lb.points DESC FETCH FIRST _NUMBER_ ROWS ONLY;"
const INSERT_LB_ENTRY_SQL = "INSERT INTO tt_points VALUES ($1, $2, $3);";
const UPDATE_LB_ENTRY_SQL = "UPDATE tt_points SET points = $3 WHERE id = $1 AND leaderboard = $2;";
const DELETE_LB_ENTRY_SQL = "DELETE FROM tt_points WHERE id = $1 AND leaderboard = $2;";
const DELETE_USER_ENTRIES_SQL = "DELETE FROM tt_points WHERE id = $1;";
const DELETE_LB_ENTRIES_SQL = "DELETE FROM tt_points WHERE leaderboard = $1;";
const GET_ALL_LB_ENTRIES_SQL = "SELECT lb.points, users.display_name FROM tt_points AS lb LEFT OUTER JOIN users ON lb.id = users.id WHERE lb.leaderboard = $1 ORDER BY lb.points DESC;";



// game:{
// 	openReason:
// 	// 'auth': forced open by an auth
// 	// 'leave': automatically opened on player leaving
// 	// 'timer': automatically opened for not asking a questions
// 	// 'user': opened by the user
// 	// ''
// }

let pgReconnect = function(message){
	try{
		if(self.data && self.data.client){
			self.data.client.end();
		}
	}catch(e){
		error(e.message);
	}

	try{
		self.data.client = new pg.Client(conInfo);
		self.data.client.connect((err)=>{
			if(err){
				error(err);
				if(message){
					chat.js.reply(message, "Unable to connect to database.");
				}
			}else{
				ok("Client is connected");
				chat.js.reply(message, "The client is now connected to the database.");
				self.data.connected = true;
			}
		});
		self.data.client.on("error",(e)=>{
			error(e.message);
		});
		self.data.client.on("end",()=>{
			self.data.connected = false;
			error("Client connection ended");
		});
	}catch(e){
		error(e.message);
		if(message){
			chat.js.reply(message, "Unable to connect to database.");
		}
	}
}

let runSql = function(statement, args, onRow, onEnd, onError){
	if(!self.data.connected){
		onError("The bot is not connected to the database.");
	}
	if(!onError){
		onError = (err)=>{
			error(err.message);
		};
	}
	try{
		let query = self.data.client.query(statement,args);
		if(onRow) query.on("row", onRow);
		if(onEnd) query.on("end", onEnd);
		query.on("error", onError);
	}catch(err){
		error(err);
	}
};

let getId = function(username, createNewEntry, onEnd, onError){
	let res;
	runSql(GET_USER_SQL, [toId(username)], (row)=>{
		res = row;
	}, ()=>{
		if(!res && createNewEntry){
			runSql(INSERT_USER_SQL, [toId(username), removeRank(username)], null, ()=>{
				runSql(INSERT_ALT_SQL, [toId(username), toId(username)], null, ()=>{
					getId(username, createNewEntry, onEnd, onError);
				}, onError);
			}, onError);
		}else{
			onEnd(res);
		}
	}, onError);
}

//args is [id, leaderboard]
let getLeaderboardEntry = function(args, onEnd, onError){
	let res;
	runSql(GET_LB_ENTRY_SQL, [args[0], toId(args[1])], (row)=>{
		res = row;
	}, ()=>{
		if(onEnd) onEnd(res);
	}, onError);
};

//args is [number of entries to get, leaderboard]
let listLeaderboardEntries = function(args, onRow, onEnd, onError){
	runSql(LIST_LB_ENTRIES_SQL.replace("_NUMBER_",args[0]), [toId(args[1])], onRow, onEnd, onError);
};

//updateFunc takes the old score, and returns what the new score should be
//onEnd takes the old row and new score, and does whatever
//args is [id, leaderboard]
let updateLeaderboardEntryById = function(args, updateFunc, onEnd, onError){
	let res;
	getLeaderboardEntry(args, (res)=>{
		if(!res){
			let newScore = updateFunc(0);
			runSql(INSERT_LB_ENTRY_SQL, [args[0], args[1], newScore], null, ()=>{
				if(onEnd){
					onEnd(res, newScore);
				}
			}, onError);
		}else{
			let newScore = updateFunc(res.points);
			runSql(UPDATE_LB_ENTRY_SQL, [args[0], args[1], newScore], null, ()=>{
				if(onEnd){
					onEnd(res, newScore);
				}
			}, onError);
		}
	}, onError);
};

let updateLeaderboardEntryByUsername = function(args, updateFunc, onEnd, onError){
	getId(args[0], true, (res)=>{
		updateLeaderboardEntryById([res.id, args[1]], updateFunc, onEnd, onError);
	}, onError);
}

//updateFunc takes the old score, and returns what the new score should be
//onEnd takes the user id, rows updated, array of events failed
let updateAllLeaderboardEntriesById = function(id, updateFunc, onEnd, onError){
	let events = [];
	runSql(GET_ENABLED_LB_SQL, [], (row)=>{
		events.push(row);
	}, ()=>{
		let entries = {};
		runSql(GET_LB_ENTRIES_SQL, [id], (row)=>{
			entries[row.leaderboard] = row;
		}, ()=>{
			events = events.map((event)=>{return event.id});
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
					runSql(UPDATE_LB_ENTRY_SQL, [id, events[i], updateFunc(entries[events[i]].points)], null, newEnd(events[i]), newError(events[i]));
				}else{
					runSql(INSERT_LB_ENTRY_SQL, [id, events[i], updateFunc(0)], null, newEnd(events[i]), newError(events[i]));
				}
			}
      if(events.length === 0) onEnd(id, 0, 0);
		}, onError);
	}, onError);
}

let updateAllLeaderboardEntriesByUsername = function(username, updateFunc, onEnd, onError){
	getId(username, true, (res)=>{
		updateAllLeaderboardEntriesById(res.id, updateFunc, (id, affected, failed)=>{
			if(onEnd) onEnd(res.display_name, affected, failed);
		});
	}, onError);
}

//args is [id, leaderboard]
let removeLeaderboardEntry = function(args, onEnd, onError){
	let res;
	getLeaderboardEntry(args, (res)=>{
		if(!res){
			onEnd(res);
		}else{
			runSql(DELETE_LB_ENTRY_SQL, args, ()=>{}, ()=>{
				if(onEnd){
					onEnd(res);
				}
			}, onError);
		}
	}, onError);
};

let removeAllLeaderboardEntries = function(id, onEnd, onError){
	runSql(DELETE_USER_ENTRIES_SQL, [id], null, onEnd, onError);
}

let transferAllPoints = function(fromId, toId, onEnd, onError, onAllFinished){
	let success = true;
	let fromEntries = {};
	let entriesToTransfer = 0;
	runSql(GET_LB_ENTRIES_SQL, [fromId], (row)=>{
		fromEntries[row.leaderboard] = row;
		entriesToTransfer++;
	}, ()=>{
		let toEntries = {};
		runSql(GET_LB_ENTRIES_SQL, [toId], (row)=>{
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
					runSql(UPDATE_LB_ENTRY_SQL, [toId, event, toEntries[event].points + fromEntries[event].points], null, endFunc, errorFunc);
				}else{
					runSql(INSERT_LB_ENTRY_SQL, [toId, event, fromEntries[event].points], null, endFunc, errorFunc);
				}
			}
		}, onError);
	}, onError);
};

//onEnd should take a functon of an array with two elements
let getMains = function(username1, username2, createNewEntry, onEnd, onError){
	let res = [];
	getId(username1, createNewEntry, (user1)=>{
		res[0] = user1;
		getId(username2, createNewEntry, (user2)=>{
			res[1] = user2;
			onEnd(res);
		}, onError);
	}, onError);
}

let changeMains = function(id, newName, onEnd, onError){
	runSql(UPDATE_USER_SQL, [id, newName], null, onEnd, onError);
}

let mergeAlts = function(fromName, toName, onEnd, onError){
	getMains(fromName, toName, true, (res)=>{
		if(res[0].id === res[1].id){
			onError("Those two accounts are the same.");
			return;
		}
		transferAllPoints(res[0].id, res[1].id, null, null, (success)=>{
			if(success){
				runSql(UPDATE_MAINS_SQL, [res[0].id, res[1].id], null, ()=>{
					runSql(DELETE_USER_SQL, [res[0].id], null, ()=>{
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

		try{
      if(self.data && self.data.client){
        self.data.client.end();
      }
    }catch(e){
      error(e.message);
    }

    self.data = {
        games: {},
				pendingAlts: {},
        askToReset: "",
        timers: {}
    };

		try{
      self.data.client = new pg.Client(conInfo);
			self.data.client.connect((err)=>{
				if(err){
					error(err);
				}else{
					ok("Client is connected");
					self.data.connected = true;
				}
			});
			self.data.client.on("error",(e)=>{
				error(e.message);
			});
			self.data.client.on("end",()=>{
				self.data.connected = false;
				error("Client connection ended");
			});
    }catch(e){
      error(e.message);
    }
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
										game.bpOpen = "leave";
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
						if(idsMatch(lastHist.active, args[3])){
							lastHist.active = args[2];
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
						let result = tryBatonPass(m.room, displayName, {active:displayName,undo: null}, game.bpOpen !== "auth", self.config.remindTime/2);
						if(result.result){
							chat.js.say(m.room, "**It is now " + displayName + "'s turn to ask a question.**");
						}
					}
				}
			}
		}
		if(idsMatch(lastHist.active, m.user) && /\*\*(([^\s])|([^\s].*[^\s]))\*\*/g.test(m.message)){
			clearTimers(game);
			lastHist.hasAsked = true;
		}else{
			let rank = auth.js.getEffectiveRoomRank(m, "trivia");
			if(auth.js.rankgeq(rank, self.config.manageBpRank) || idsMatch(lastHist.active, m.user)){
				if(/\*\*([^\s].*)?veto(.*[^\s])?\*\*/i.test(m.message) || /^\/announce .*veto.*/i.test(m.message)){
					lastHist.hasAsked = false;
					clearTimers(game);
					game.remindTimer = setTimeout(()=>{
						onRemind(game);
					}, self.config.remindTime*1000);
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
		if(args.length>1 && auth.js.rankgeq(rank, self.config.manageBpRank)){
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
					userMatchesHistory = false;
				}else if(auth.js.rankgeq(rank, self.config.manageBpRank) || userMatchesHistory){
					let nextPlayer = rooms.js.getDisplayName(args[0], room);
					let result = tryBatonPass(room, args[0], {active:nextPlayer, undo:function(){
						updateAllLeaderboardEntriesByUsername(nextPlayer, (oldPoints)=>{
							return Math.max(oldPoints - 1, 0);
						});
					}}, false);
					success = result.result;
					if(success){
						updateAllLeaderboardEntriesByUsername(nextPlayer, (oldPoints)=>{
							return oldPoints + 1;
						});
						chat.js.say(room, result.response);
					}else{
						if(nextPlayer && getBlacklistEntry(toId(nextPlayer))){
							if(!game.bpOpen){
								response = "**" + nextPlayer + " is on the blacklist, so BP is now open.**"
							}else{
								response = result.response;
							}
							game.bpOpen = "auth";
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
						if(rooms.js.isInRoom(newActive, room)){
							response += ", it is now " + newActive + "'s turn to ask a question.**";
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
				chat.js.reply(message, name + " currently has BP" + (game.bpOpen ? " (BP is open)." : "."));
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
	bl: "blacklist",
	blacklist: function(message, args, rank){
		let response = "Your rank is not high enough to use the blacklist command.";
		let leaderboard = self.data.leaderboard;
		if(auth.js.rankgeq(rank, self.config.manageBlRank)){
			if(args.length<2){
				response = "Not enough arguments were given for the blacklist command.";
			}else{
				let command = toId(args[0])
				let username = toId(args[1]);
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
							chat.js.say("trivia", "/modnote " + args[1] + " was added to the Trivia Tracker blacklist by " + message.user + " for " + millisToTime(duration*60000) + ". (" + reason + ")");
						}else{
							leaderboard.blacklist[username] = {displayName: args[1], reason: reason};
							response = "Added " + args[1] + " to the blacklist.";
							chat.js.say("trivia", "/modnote " + args[1] + " was added to the Trivia Tracker blacklist by " + message.user + ". (" + reason + ")");
						}
					}
				}else if(command === "remove"){
					if(!entry){
						response = "The user " + args[1] + " is not on the blacklist.";
					}else{
						delete leaderboard.blacklist[username];
						response = "Removed " + entry.displayName + " from the blacklist.";
						chat.js.say("trivia","/modnote " + entry.displayName + " was removed from the Trivia Tracker blacklist by " + message.user);
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
	next: function(message, args, rank){
		let timeDiff = (1457024400000-new Date().getTime())%14400000+14400000;
		let response = "The next official is (theoretically) in " + millisToTime(timeDiff) + ".";
		chat.js.reply(message, response);
	},
	alts: function(message, args, rank){
		let target = toId(args[0]) ? args[0] : message.user;
		getMains(message.user, target, false, (res)=>{
			if(!auth.js.rankgeq(rank, "%") && (!res[0] || !res[1] || (res[0].id !== res[1].id))){
				chat.js.reply(message, "Your rank is not high enough to check other users' alts.")
			}else if(!res[1]){
				chat.js.reply(message, target + " does not have any alts.");
			}else{
				let alts = [];
				runSql(GET_ALTS_SQL, [res[1].id], (row)=>{
					alts.push(row);
				}, ()=>{
					alts = alts.map((alt)=>{return alt.username});
					let text = alts.length ? res[1].display_name + "'s alts: " + alts.shift() : target + " does not have any alts";
					while(alts.length && text.length + alts[0].length < 280){
						text += ", " + alts.shift();
					}
					if(alts.length){
						text += " and " + alts.length + " more";
					}
					chat.js.reply(message, text + ".");
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
					chat.js.reply(message, "There was an error while linking accounts.");
				});
			}else{
				if(!pendingAlts[user]){
					pendingAlts[user] = [];
				}
				if(pendingAlts[user].indexOf(altuser) === -1){
					pendingAlts[user].push(altuser);
				}
				chat.js.reply(message, "Now say \"~alt " + user + "\" on that account to link them.");
			}
		}
	},
  removealt: function(message, args, rank){
    if(args.length===0 || !args[0]){
			chat.js.reply(message, "You must specify an alt.");
		}else{
      getMains(message.user, args[0], idsMatch(args[0], message.user), (res)=>{
        if(res.length < 2 || res[0].id !== res[1].id){
          chat.js.reply(message, "That account is not an alt of yours.");
        }else if(idsMatch(args[0], res[1].display_name)){
          chat.js.reply(message, "You cannot remove your main account.");
        }else{
          runSql(DELETE_ALT_SQL, [toId(args[0])], null, (res)=>{
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
		if(args.length===0 || !args[0]){
			chat.js.reply(message, "You must specify an alt.");
		}else if(args[0].length>20){
			chat.js.reply(message, "That name is too long.");
		}else{
			getMains(message.user, args[0], idsMatch(args[0], message.user), (res)=>{
				if(!res[0]){
					chat.js.reply(message, "You do not have any alts.");
				}else if(!res[1] || res[0].id !== res[1].id){
					chat.js.reply(message, "That account is not one of your alts.");
				}else{
					changeMains(res[0].id, removeRank(args[0]), ()=>{
						chat.js.reply(message, "Your name was successfully changed.");
					}, (err)=>{
						error(JSON.stringify(err));
						chat.js.reply(message, "There was an error while changing your main account name.");
					});
				}
			}, (err)=>{
				error(err);
				chat.js.reply(message, "Something went wrong when finding your main.");
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
  //~timer [minutes], {message}, {room}
  timer: function(message, args){
    let room = toRoomId(args[2]) || message.room;
    let announcement = args[1] || "Timer's up!";
    let duration = args[0] && /^\d+$/.test(args[0]) && parseInt(args[0]);
    if(duration>30){
      duration = 0;
    }
    if(!duration){
      chat.js.reply(message, "You must give a positive integer less than 30 for the duration.");
    }else if(room){
      let rank = auth.js.getRoomRank(message.user, room);
      let timerName = "room:" + room;
      if(!auth.js.rankgeq(rank, self.config.timerRank)){
        chat.js.reply(message, "You rank is not high enough to set timers in " + room + ".");
      }else if(self.data.timers[timerName]){
        chat.js.reply(message, "There is already a timer for " + room + ".");
      }else{
        self.data.timers[timerName] = {
          room: room,
          timer: setTimeout(()=>{
            delete self.data.timers[timerName];
            chat.js.say(room, announcement);
          }, duration*60*1000)
        };
        chat.js.reply(message, "Set the timer for " + duration + " minutes.");
      }
    }else{
      let timerName = "user:" + toId(message.user);
      if(self.data.timers[timerName]){
        chat.js.reply(message, "You already have a timer.");
      }else{
        self.data.timers[timerName] = {
          room: room,
          timer: setTimeout(()=>{
            delete self.data.timers[timerName];
            chat.js.pm(message.user, announcement);
          }, duration*60*1000)
        };
        chat.js.reply(message, "Set the timer for " + duration + " minute" + (duration === 1 ? "." : "s."));
      }
    }
  },
	info: "help",
	commands: "help",
	help: function(message, args){
		if(chat&&chat.js){
			chat.js.reply(message, "This pdf contains all the commands you need to know: https://drive.google.com/file/d/0B8KyGlawfHaKRUZxZGlqQ3RkVlk/view?usp=sharing");
		}
	},
  rules: function(message, args){
		if(chat&&chat.js){
			chat.js.reply(message, "Here are the rules for questions: https://docs.google.com/document/d/1t-TWMx-1aQ1eRlXJFjpLME4JNiCfo_s5cU5WaTgxTX0/edit#");
		}
	},
	legacyrules: function(message, args){
		if(chat&&chat.js){
			chat.js.reply(message, "Here are the rules for questions: https://drive.google.com/file/d/0B6H5ZoTTDakRYTBNMzUtWUNndWs/view");
		}
	},
	intro: function(message, args, rank){
		chat.js.reply(message, "Here is a beginner's guide to Trivia Tracker (with pictures!): https://docs.google.com/document/d/1dHRz0vSEuF3WwWnqxVZdss9C1dZE37DrmAVqt0HRTEk");
	},
  plug: function(message, args, rank){
    chat.js.reply(message, "https://plug.dj/trivia");
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
	},
	reconnect: function(message, args, rank){
		if(auth.js.rankgeq(rank,"@")){
			pgReconnect(message);
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
		let response = "The top " + number + " scores in the " + lb + " leaderboard are:";
		let rows = [];
		listLeaderboardEntries([number, lb], (row)=>{
			rows.push(row);
		},()=>{
			if(!rows.length){
				chat.js.reply(message, "There are no players on the " + lb + " leaderboard.");
			}else{
				chat.js.reply(message, "The top " + rows.length + " scores in the " + lb + " leaderboard are: " + rows.map((row)=>{return "__" + (row.display_name || row.id1) + "__: " + row.points}).join(", ") + ".");
			}
		},(err)=>{
			error(err);
			chat.js.reply(message, "There was either an error fetching the scores or the leaderboard you entered does not exist.");
		});
	},
	check: function(message, args, rank){
		let response = "Something has probably gone very wrong if you see this text";
		let user = args[1] || message.user;
		let lb = toId(args[2]) || "main";
    let lbExists = false;
		runSql(GET_ALL_LB_SQL, [], (row)=>{
			if(row.id === lb) lbExists = true;
		}, ()=>{
			if(!lbExists){
				chat.js.reply(message, "The leaderboard you entered does not exist.");
			}else{
				let res;
				getId(user, false, (res)=>{
					if(!res){
						chat.js.reply(message, user + " does not have a score on the " + lb + " leaderboard.");
					}else{
						getLeaderboardEntry([res.id, lb], (entry)=>{
							if(!entry){
								chat.js.reply(message, res.display_name + " does not have a score on the " + lb + " leaderboard.");
							}else{
								chat.js.reply(message, res.display_name + "'s score on the " + lb + " leaderboard is " + entry.points + ".");
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
	//Number of people, your place, your score, points to next place
	summary: function(message, args, rank){
    let lb = toId(args[1]) || "main";
    let id = toId(message.user);
    let lbExists = false;
    runSql(GET_ALL_LB_SQL, [], (lbRow)=>{
			if(lbRow.id === lb) lbExists = true;
		}, ()=>{
			if(!lbExists){
				chat.js.reply(message, "The leaderboard you entered does not exist.");
			}else{
				let res;
				getId(id, false, (res)=>{
					if(!res){
						chat.js.reply(message, "You do not have a score on the " + lb + " leaderboard.");
					}else{
						getLeaderboardEntry([res.id, lb], (entry)=>{
							if(!entry){
								chat.js.reply(message, "You do not have a score on the " + lb + " leaderboard.");
							}else{
                let score = entry.points;
                let entries = [];
                runSql(GET_ALL_LB_ENTRIES_SQL, [lb], (row)=>{
                  entries.push(row)
                }, (res)=>{
                  if(entries.length === 0){
                    chat.js.reply(message, "There doesn't seem to be anyone on the leaderboard. Maybe something went wrong.");
                  }else if(entries.length === 1){
                    chat.js.reply(message, "You are the only person on the leaderboard (and your score is " + score + ").");
                  }else{
                    if(entries[0].points === score){
                      chat.js.reply(message, "You are first on the leaderboard, second place is " + entries[1].display_name + " with " + entries[1].points + " points.");
                    }else{
                      let higherEntries = entries.filter(item=>{return item.points > score});
                      let response = "First place is " + entries[0].display_name + " with " + entries[0].points + " points.";
                      response += " Your rank is " + (higherEntries.length+1) + " with " + score + " points.";
                      response += " The next player above you is " + higherEntries[higherEntries.length - 1].display_name + " with " + higherEntries[higherEntries.length - 1].points + " points.";
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
		chat.js.reply(message, "Not yet implemented :<");
		let response = "Not yet implemented :<";
		return;
		let leaderboard = self.data.leaderboard.players;
		let userEntry = leaderboard[toId(getMain(message.user))];
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
		if(!auth.js.rankgeq(rank, self.config.editScoreRank)){
			chat.js.reply(message, "Your rank is not high enough to change someone's score.");
		}else	if(args.length<=2 || !toId(args[1])){
			chat.js.reply(message, "You must specify the user's name, and the number of points to add.");
		}else if(!/^[\d]+$/.test(args[2])){
			chat.js.reply(message, "Invalid number format for the number of points.");
		}else{
			let user = args[1];
			let points = parseInt(args[2], 10);
			let lb = args[3] || "main"
      let lbExists = false;
			runSql(GET_ALL_LB_SQL, [], (row)=>{
				if(row.id === lb){
					lbExists = true;
				}
			}, ()=>{
				if(!lbExists){
					chat.js.reply(message, "That leaderboard doesn't exist.");
				}else{
					updateLeaderboardEntryByUsername([user, lb], (oldPoints)=>{
						return points;
					}, (res, newPoints)=>{
						if(!res){
							chat.js.reply(message, "Created a new " + lb + " leaderboard entry for " + user + " and set their score to " + newPoints + ".");
						}else{
							chat.js.reply(message, "Updated the score for " + res.display_name + ". Their " + lb + " leaderboard score changed from " + res.points + " to " + newPoints + ".");
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
			});
		}
	},
	remove: function(message, args, rank){
		if(!toId(args[1])){
			chat.js.reply(message, "You must specify a user.");
		}else if(!auth.js.rankgeq(rank, self.config.editScoreRank)){
			chat.js.reply(message, "Your rank is not high enough to remove someone's leaderboard entries.");
		}else{
			getId(args[1], false, (user)=>{
				if(!user){
					chat.js.reply(message, args[1] + " does not have any leaderboard entries.");
				}else{
					removeAllLeaderboardEntries(user.id, (res)=>{
						chat.js.reply(message, "Removed " + res.rowCount + " leaderboard entries for " +  args[1] + ".");
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
        getId(message.user, true, (user)=>{
          runSql(DELETE_LB_ENTRIES_SQL, ["main"], null, (res)=>{
            runSql(RESET_MAIN_LB_SQL, [user.id], null, (res)=>{
              chat.js.reply(message, "Successfully deleted " + res.rowCount + " score(s) from the main leaderboard.");
    					self.data.askToReset = "";
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
			}else{
				self.data.askToReset = message.user;
				chat.js.reply(message, "Are you sure you want to reset the leaderboard? (Enter the reset command again to confirm)");
			}
		}
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
		let events = [];
		runSql(GET_ALL_LB_SQL, [], (row)=>{
			events.push(row);
		}, ()=>{
			if(!events.length){
				chat.js.reply(message, "There are no leaderboards right now.");
			}else{
				chat.js.reply(message, "These are the current leaderboads: " + events.map((event)=>{return event.display_name}).join(", "));
			}
		}, (err)=>{
			error(err);
			chat.js.reply(message, "There was an error fetching the leaderboards.");
		});
	},
	add: function(message, args, rank){
		if(!auth.js.rankgeq(rank, self.config.manageEventRank)){
			chat.js.reply(message, "Your rank is not high enough to create a leaderboard.");
		}else if(args.length<=2 || !toId(args[2])){
			chat.js.reply(message, "You must specify the name for the leaderboard.");
		}else if(args[2].length > 20){
			chat.js.reply(message, "That name is too long.");
		}else{
			let displayName = args[2];
			let lb;
			runSql(GET_LB_SQL, [toId(displayName)], (row)=>{
				lb = row;
			}, ()=>{
				if(lb){
					chat.js.reply(message, "A leaderboard already exists with the same name.");
				}else{
					getId(message.user, true, (res)=>{
						runSql(INSERT_LB_SQL, [toId(displayName), displayName, res.id], null, ()=>{
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
		}else if(args.length<=2){
			chat.js.reply(message, "You must specify the name for the leaderboard.");
		}else if(toId(args[2]) === "main"){
			chat.js.reply(message, "You cannot remove that leaderboard.");
		}else{
			let id = toId(args[2]);
			let lb;
			runSql(GET_LB_SQL, [id], (row)=>{
				lb = row;
			}, ()=>{
				if(!lb){
					chat.js.reply(message, "There is no leaderboard with that name.");
				}else{
					runSql(DELETE_LB_ENTRIES_SQL, [id], null, (res)=>{
						runSql(DELETE_LB_SQL, [id], null, ()=>{
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
    let lbName = args[2] || "main";
		let id = toId(lbName);
		let lb;
		runSql(GET_LB_SQL, [id], (row)=>{
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
		}else if(args.length<3){
			chat.js.reply(message, "You must specify the name for the leaderboard.");
		}else{
      let id = toId(args[2]);
      let lbs = {};
      runSql(GET_ALL_LB_SQL, [], (row)=>{
        lbs[row.id] = row;
      }, (res)=>{
        if(!lbs[id]){
          chat.js.reply(message, "The leaderboard you specified doesn't exist.");
        }else if(lbs[id].enabled){
          chat.js.reply(message, "That leaderboard is already enabled.");
        }else{
          runSql(UPDATE_LB_SQL, [id, true], null, (res)=>{
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
		}else if(args.length<3){
			chat.js.reply(message, "You must specify the name for the leaderboard.");
		}else{
      let id = toId(args[2]);
      let lbs = {};
      runSql(GET_ALL_LB_SQL, [], (row)=>{
        lbs[row.id] = row;
      }, (res)=>{
        if(!lbs[id]){
          chat.js.reply(message, "The leaderboard you specified doesn't exist.");
        }else if(!lbs[id].enabled){
          chat.js.reply(message, "That leaderboard is already disabled.");
        }else{
          runSql(UPDATE_LB_SQL, [id, false], null, (res)=>{
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

let tryBatonPass = function(room, nextPlayer, historyToAdd, shouldUndo, remindTime){
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
		}
	}
	return {result: result, response: response};
};

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
	}else if(game.bpOpen == "leave"){
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

let defaultConfigs = {
  timerRank: "%",
	startGameRank: "+",
	endGameRank: "%",
  manageBpRank: "+",
  manageBlRank: "@",
	editScoreRank: "@",
	resetLeaderboardRank: "#",
	manageEventRank: "#",
  remindTime: 240,
  openTime: 60
};

exports.defaultConfigs = defaultConfigs;

let configTypes = {
  timerRank: "rank",
	startGameRank: "rank",
	endGameRank: "rank",
  manageBpRank: "rank",
  manageBlRank: "rank",
	editScoreRank: "rank",
	resetLeaderboardRank: "rank",
	manageEventRank: "rank",
  remindTime: "int",
  openTime: "int"
};

exports.configTypes = configTypes;
