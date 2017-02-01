let self = {js:{},data:{},requiredBy:[],chathooks:{},messagehooks:{},config:{}};
let fs = require("fs");
let request = require("request");
let rooms = null;
let auth = null;
let chat = null;
let pg = require("pg");
const conInfo = {
      user: mainConfig.dbuser,
      password: mainConfig.dbpassword,
      database: mainConfig.dbname,
      host: mainConfig.dbhost,
      port: mainConfig.dbport
};
const VOTE_TIME = 30;
const DECIDE_TIME = 30;
const BANK_TIME = 6;
const ROUND_TIME = 180;
const BREAK_TIME = 30;
const QUESTION_TIME = 7;
const FINAL_BREAK = 10;
const POT_AMOUNTS = [0, 1000, 2500, 5000, 10000, 25000, 50000, 75000, 125000];
const GAME_RANK = "%";
const QUESTION_RANK = "%";

const GET_USER_SQL = "SELECT users.id, users.username, users.display_name FROM alts INNER JOIN users ON alts.main_id = users.id WHERE alts.username = $1 FETCH FIRST 1 ROWS ONLY;";
const INSERT_USER_SQL = "INSERT INTO users (username, display_name) VALUES ($1, $2);";
const INSERT_ALT_SQL = "INSERT INTO alts (username, main_id) VALUES ($1, (SELECT id FROM users WHERE username = $2 FETCH FIRST 1 ROWS ONLY));";
const GET_ENTRY_SQL = "SELECT * FROM wl_lb WHERE id = $1 FETCH FIRST 1 ROWS ONLY;";
const UPDATE_ENTRY_SQL = "UPDATE wl_lb SET correct = $2, incorrect = $3, passed = $4, wins = $5, banked = $6, won = $7 WHERE id = $1;"
const INSERT_ENTRY_SQL = "INSERT INTO wl_lb VALUES($1, $2, $3, $4, $5, $6, $7);"

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

let getEntryById = function(id, onEnd, onError){
	let res;
	info("GETTING ENTRY FOR " + toId(id));
	runSql(GET_ENTRY_SQL, [id], (row)=>{
		info(JSON.stringify(row));
		res = row;
	}, ()=>{
		info(JSON.stringify(res));
		onEnd(res);
	}, onError);
}

let getEntryByName = function(username, onEnd, onError){
	let res;
	info("GETTING ENTRY FOR " + toId(id));
	getId(username, false, (user)=>{
    if(user){
      getEntryById(user.id, (res)=>{
        onEnd(res);
      }, onError);
    }else{
      return null;
    }
  }, onError);
}

let updateEntry = function(entry, onEnd, onError){
	runSql(UPDATE_ENTRY_SQL, [entry.id, entry.correct, entry.incorrect, entry.passed, entry.wins, entry.banked, entry.won], onEnd, onError);
}

let insertEntry = function(entry, onEnd, onError){
	runSql(INSERT_ENTRY_SQL, [entry.id, entry.correct, entry.incorrect, entry.passed, entry.wins, entry.banked, entry.won], onEnd, onError);
}

let updateUserNoChange = function(id, updateFunc, onEnd, onError){
	info("UPDATING USER NO CHANGE " + id);
	getEntryById(id, (res)=>{
		info(JSON.stringify(res));
		if(!res){
			res = {id: id, correct: 0, incorrect: 0, passed: 0, wins: 0, banked: 0, won: 0};
			insertEntry(updateFunc(res), onEnd, onError);
		}else{
			updateEntry(updateFunc(res), onEnd, onError);
		}
	}, onError);
}

let updateUser = function(username, updateFunc, onEnd, onError){
	info("UPDATING USER " + username);
	getId(username, true, (user)=>{
		updateUserNoChange(user.id, updateFunc, onEnd, onError);
	}, onError);
}

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
      questions: {
				regular: [],
				final: []
			}
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
    loadQuestions();
	}

	self.chathooks = {
		chathook: function(m){
			if(m && !m.isInit){
				let text = m.message;
				if(text[0]==="~"||text[0]==="."){
					let command = text.split(" ")[0].trim().toLowerCase().substr(1);
					let argText = text.substring(command.length+2, text.length);
					let chatArgs = argText === "" ? [] : argText.split(",");
					for(let i = 0;i<chatArgs.length;i++){
						chatArgs[i] = chatArgs[i].trim();
					}
					if(commands[command]&&auth&&auth.js&&chat&&chat.js){
						let rank = auth.js.getEffectiveRoomRank(m, "trivia");
						let qwrank = auth.js.getEffectiveRoomRank(m, "questionworkshop");
						let commandToRun = commands[command];
						if(typeof commandToRun === "string"){
							commandToRun = commands[commandToRun];
						}
						commandToRun(m, chatArgs, rank, qwrank);
					}
				}
			}
		}
	};
	self.messagehooks = {

	};
};

exports.onUnload = function(){
	saveQuestions();
};

exports.refreshDependencies = function(){
	rooms = getModuleForDependency("rooms", "wl");
	auth = getModuleForDependency("auth", "wl");
	chat = getModuleForDependency("chat", "wl");
};

exports.onConnect = function(){

};

let commands = {
  wl: function(message, args, rank){
    if(args.length > 0){
      let command = wlcommands[args[0].toLowerCase()];
      if(typeof command === "string"){
        command = wlcommands[command];
      }
			if(command){
				command(message, args, rank);
			}
    }
  },
	wll: function(message, args, rank){
    if(args.length > 0){
      let command = wllcommands[args[0].toLowerCase()];
      if(typeof command === "string"){
        command = wllcommands[command];
      }
			if(command){
				command(message, args, rank);
			}
    }
  },
  question: function(message, args, rank, qwrank){
    if(args.length > 0){
      let command = questioncommands[args[0].toLowerCase()];
      if(typeof command === "string"){
        command = questioncommands[command];
      }
			if(command){
				command(message, args, rank, qwrank);
			}
    }
  },
  pass: function(message, args, rank){
		let response = "whoops";
		let room = message.room;
		let game = self.data.games[room];
		let id = toId(message.user);
		let success = false;
		let isHost = auth.js.rankgeq(rank, GAME_RANK);
		if(!message.room){
			response = "You shouldn't be using this through PM."
		}else if(!game){
			response = "There is no game in this room";
		}else if(!game.question || (game.finalists && game.finalists.length)){
			response = "There is no question right now.";
		}else{
			let player = game.players.filter(item=>{return item.id === id})[0];
			if(!player && !isHost){
				response = "You are not in the game.";
			}else if(game.players.indexOf(player) !== game.active && !isHost){
				response = "You are not the active player.";
			}else{
				success = true;
				chat.js.say(game.room, "The pot is now empty.");
				game.pot = 0;
				updateUser(game.players[game.active].id, (entry)=>{
					entry.passed++;
					return entry;
				});
				prepQuestion(game);
			}
		}
		if(!success){
			chat.js.reply(message, response);
		}
  },
  bank: function(message, args, rank){
		let room = message.room;
    let response = "uh oh";
    let success = false;
		let game = self.data.games[room];
    if(!room){
      response = "This cannot be done through PM.";
    }else if(!game){
      response = "There is no game in " + room + ".";
    }else if(!game.canBank){
			response = "You cannot bank at this time.";
		}else if(game.players[game.active].id !== toId(message.user)){
      response = "You are not the active player.";
    }else if(game.pot === 0){
			response = "The pot is empty.";
		}else{
			success = true;
      let amount = POT_AMOUNTS[game.pot];
			game.bank+=amount;
			game.players[game.active].banked+=amount;
			game.pot = 0;
			chat.js.say(room, "The pot has been banked. There is now $" + game.bank + " in the bank.");
      updateUser(game.players[game.active].id, (entry)=>{
        entry.banked+=amount;
        return entry;
      });
    }
    if(!success){
      chat.js.reply(message, response);
    }
  },
	checkbank: function(message, args, rank){
		let room = message.room || toRoomId(args[0]);
    let response = "uh oh";
		let game = self.data.games[room];
    if(!game){
      response = "There is no game in " + room + ".";
    }else{
			response = "There is $" + game.bank + " in the bank.";
		}
    chat.js.reply(message, response);
	},
	addbank: function(message, args, rank){
		let room = args.length > 1 ? toRoomId(args[1]) : message.room;
    let response = "uh oh";
		if(args.length === 0){
			response = "You must specify the amount to add.";
		}else if(!room){
      response = "You must specify a room for the game.";
    }else if(!auth.js.rankgeq(rank, GAME_RANK)){
      response = "Your rank is not high enough to add money to the bank.";
    }else if(!self.data.games[room]){
      response = "There is no game in " + room + ".";
    }else if(!/^-?\d+$/.test(args[0])){
			response = "The amount to add must be an integer.";
		}else{
			let game = self.data.games[room];
			game.bank+=Number(args[0]);
      response = "There is now $" + game.bank + " in the bank.";
    }
    chat.js.reply(message, response);
	},
	setbank: function(message, args, rank){
		let room = args.length > 1 ? toRoomId(args[1]) : message.room;
		let response = "uh oh";
		if(args.length === 0){
			response = "You must specify the amount to set the bank to.";
		}else if(!room){
			response = "You must specify a room for the game.";
		}else if(!auth.js.rankgeq(rank, GAME_RANK)){
			response = "Your rank is not high enough to add money to the bank.";
		}else if(!self.data.games[room]){
			response = "There is no game in " + room + ".";
		}else if(!/^-?\d+$/.test(args[0])){
			response = "The amount must be an integer.";
		}else{
			let game = self.data.games[room];
			game.bank=Number(args[0]);
			response = "There is now $" + game.bank + " in the bank.";
		}
		chat.js.reply(message, response);
	},
	checkvotes: function(message, args, rank){
		let room = message.room || toRoomId(args[0]);
		let game = self.data.games[room]
		let response = "whoops";
		if(!game){
			response = "There is no game in " + room + ".";
		}else if(!game.canVote){
			response = "Voting is not open.";
		}else{
			let notVoted = game.players.slice().filter(item=>{return !game.votes[item.id]});
			response = "These players have not voted: " + notVoted.map(item=>{return item.displayName}).join(", ");
		}
		chat.js.reply(message, response);
	},
	"answer": "a",
	"g": "a",
	a: function(message, args, rank){
		let response = "whoops";
		let room = message.room;
		let game = self.data.games[room];
		let id = toId(message.user);
		let success = false;
		if(!message.room){
			response = "You shouldn't be using this through PM."
		}else if(args.length === 0){
			response = "You need to give an answer.";
		}else if(!game){
			response = "There is no game in this room";
		}else if(!game.question){
			response = "There is no question right now.";
		}else{
			let player;
			if(game.finalists){
				player = game.finalists.filter(item=>{return item.id === id})[0];
			}else{
				player = game.players.filter(item=>{return item.id === id})[0];
			}
			if(!player){
				response = "You are not in the game.";
			}else if((!(game.finalists && game.finalists.length) && game.players.indexOf(player) !== game.active) || (game.finalists && game.finalists.indexOf(player) !== game.active)){
				response = "You are not the active player.";
			}else{
				let answer = toId(args[0]);
				if(game.finalists){
					finalAnswerQuestion(game, answer);
					return;
				}
				success = true;
				let correct = false;
				for(let i=0;i<game.question.answers.length;i++){
					let cAnswer = game.question.answers[i];
					if(answer === cAnswer || cAnswer.length > 5 && levenshtein(answer,cAnswer) < 3){
						correct = true;
						break;
					}
				}
				if(correct){
					player.correctAnswers++;
					game.pot++;
					if(game.pot === POT_AMOUNTS.length-1){
						chat.js.say(game.room, "Correct, there is now " + POT_AMOUNTS[game.pot] + " in the pot. It will be automatically banked and the round will end.");
						game.bank+=POT_AMOUNTS[game.pot];
						game.pot = 0;
						updateUser(player.id, (entry)=>{
							entry.correct++;
							entry.banked+=POT_AMOUNTS[POT_AMOUNTS.length-1];
							return entry;
						});
						endRound(game);
						return;
					}else{
						chat.js.say(game.room, "Correct, there is now $" + POT_AMOUNTS[game.pot] + " in the pot.");
						updateUser(player.id, (entry)=>{
							entry.correct++;
							return entry;
						});
					}
				}else{
					chat.js.say(game.room, "Incorrect, the pot is now empty.");
					game.pot = 0;
					updateUser(player.id, (entry)=>{
						entry.incorrect++;
						return entry;
					});
				}
				prepQuestion(game);
			}
		}
		if(!success){
			chat.js.reply(message, response);
		}
	},
	vote: function(message, args, rank){
		let response = "this should probably say something meaningful";
		if(message.room){
			response = "You should only use ~vote through PM.";
		}else if(args.length < 1){
			response = "You must specify the person you are voting for.";
		}else{
			let vote = toId(args[0]);
			let id = toId(message.user);
			let game;
			for(let gameRoom in self.data.games){
				let testGame = self.data.games[gameRoom];
				if(testGame.players.filter(item=>{return item.id === id}).length > 0){
					game = testGame;
					break;
				}
			}
			if(!game){
				response = "You are not playing any games of The Weakest Link.";
			}else if(!game.canVote){
				response = "It is not time to vote on the weakest link.";
			}else{
				let player = game.players.filter((item)=>{return item.id === vote})[0];
				if(!player){
					response = "That player is not in the game.";
				}else if(game.votes[id] === vote){
					response = "You already voted for " + player.displayName + ".";
				}else if(!game.votes[id]){
					game.votes[id] = vote;
					response = "You have voted for " + player.displayName + ".";
				}else{
					game.votes[id] = vote;
					response = "You have changed your vote to " + player.displayName + ".";
				}
				onVote(game);
			}
		}
		chat.js.reply(message, response);
	},
	decide: function(message, args, rank){
		let response = "stuff";
		let room = message.room || toRoomId(args[1]);
		let game = self.data.games[room];
		let id = toId(message.user);
		let vote = toId(args[0]);
		let success = false;
		if(!game){
			response = "There is no game in " + room + ".";
		}else if(!game.strongest){
			response = "It is not time to decide the weakest link.";
		}else if(game.strongest.id !== toId(message.user)){
			response = "You are not the strongest link.";
		}else{
			let decision = toId(args[0]);
			if(game.weakest.filter(item=>{return item.id === decision}).length === 0){
				response = "That user is not an option.";
			}else{
				success = true;
				let player = game.players.filter(item=>{return item.id === decision})[0];
				game.players.splice(game.players.indexOf(player), 1);
				if(game.players.indexOf(game.strongest) !== -1){
					game.active = game.players.indexOf(game.strongest);
				}else{
					game.active = game.players.indexOf(game.second);
				}
				game.votes = {};
				game.round++;
				game.weakest = null;
				game.strongest = null;
				game.second = null;

				chat.js.say(game.room, player.displayName + ", you are the weakest link. Goodbye!");
				if(game.players.length === 2){
					if(game.active === 0){
						game.finalists = [game.players[0], game.players[1]];
					}else{
						game.finalists = [game.players[1], game.players[0]];
					}
					game.active = 0;
					chat.js.say(game.room, "There are two players left, the head-to-head round will begin in " + BREAK_TIME + " seconds. " + game.finalists[0].displayName + " will be first.");
					game.breakTimer = setTimeout(()=>{
						startRound(game);
					}, BREAK_TIME*1000);
				}else if(game.players.length === 1){
					chat.js.say(game.room, "The only player left is " + game.players[0].displayName + ". The game is probably over or something.");
				}else if(game.players.length === 0){
					chat.js.say(game.room, "There are no players left. Something terrible has happened.");
				}else{
					chat.js.say(game.room, "The next round will start in " + BREAK_TIME + " seconds, and it will be " + game.players[game.active].displayName + "'s turn to answer.");
					game.breakTimer = setTimeout(()=>{
						startRound(game);
					}, BREAK_TIME*1000);
				}
			}
		}
		if(!success){
			chat.js.reply(message, response);
		}
	}
};

let wlcommands = {
  newgame: function(message, args, rank){
    let room = args.length > 1 ? toId(args[1]) : message.room;
    let response = "uh oh";
    let success = false;
    if(!room){
      response = "You must specify a room for the game.";
    }else if(!auth.js.rankgeq(rank, GAME_RANK)){
      response = "Your rank is not high enough to start a game.";
    }else if(self.data.games[room]){
      response = "There is already a game in " + room + ".";
    }else{
      success = true;
      self.data.games[room] = {
				question: null,
				room: room,
        players: [],
				out: [],
        active: 0,
        bank: 0,
				canBank: false,
				canVote: false,
				votes: {},
        pot: 0,
        round: 1,
        started: false,
				questions: [],
				bankTimer: null,
				roundTimer: null,
				voteTimer: null,
				questionTimer: null,
				categories: []
      }
      chat.js.say(room, "A game of The Weakest Link has started.");
    }
    if(!success){
      chat.js.reply(message, response);
    }
  },
  endgame: function(message, args, rank){
    let room = args.length > 1 ? toId(args[1]) : message.room;
    let response = "uh oh";
    let success = false;
    if(!room){
      response = "You must specify a room for the game.";
    }else if(!auth.js.rankgeq(rank, GAME_RANK)){
      response = "Your rank is not high enough to end a game.";
    }else if(!self.data.games[room]){
      response = "There is no game in " + room + ".";
    }else{
      success = true;
			let game = self.data.games[room];
			clearTimers(game);
      delete self.data.games[room];
      chat.js.say(room, "The game of The Weakest Link has been ended.");
    }
    if(!success){
      chat.js.reply(message, response);
    }
  },
	addplayer: "addplayers",
	addplayers: function(message, args, rank){
		let room = message.room;
		let response = "uh oh";
		if(args.length < 2){
			response = "You cannot use this command through PM.";
		}else if(!auth.js.rankgeq(rank, GAME_RANK)){
			response = "Your rank is not high enough to use that command.";
		}else if(!self.data.games[room]){
			response = "There is no game in " + room + ".";
		}else{
			let game = self.data.games[room];
			let added = 0;
			for(let i=1;i<args.length;i++){
				let displayName = rooms.js.getDisplayName(args[i], room);
				let id = toId(args[i]);
				if(displayName){
					let isInGame = false;
					for(let j=0;j<game.players.length;j++){
						if(game.players[j].id === id){
							isInGame = true;
							break;
						}
					}
					if(!isInGame){
						added++;
						game.players.push({
							id: id,
							displayName: displayName,
							banked: 0,
							correctAnswers: 0
						});
					}
				}
			}
			response = "Added " + added + " player" + (added === 1 ? "." : "s.");
		}
		chat.js.reply(message, response);
  },
	removeplayer: "removeplayers",
	removeplayers: function(message, args, rank){
		let room = message.room;
		let response = "uh oh";
		let game = self.data.games[room];
		let shouldPrep = false;
		if(args.length < 2){
			response = "You cannot use this command through PM.";
		}else if(!auth.js.rankgeq(rank, GAME_RANK)){
			response = "Your rank is not high enough to use that command.";
		}else if(!self.data.games[room]){
			response = "There is no game in " + room + ".";
		}else{
			let num = game.players.length;
			let active = game.players[game.active].id;
			for(let i=1;i<args.length;i++){
				let id = toId(args[i]);
				delete game.votes[id];
				game.players = game.players.filter(item=>{return item.id !== id});
			}
			let newActive = game.players.indexOf(game.players.filter(item=>{return item.id === active})[0]);
			if(newActive > -1){
				game.active = newActive;
			}else{
				if(game.roundTimer){
					if(game.bankTimer){
						clearTimeout(game.bankTimer);
						game.bankTimer = null;
					}
					shouldPrep = true;
				}
			}
			response = "Removed " + (num-game.players.length) + " player" + ((num-game.players.length) === 1 ? "." : "s.");
			onVote(game);
		}
		chat.js.reply(message, response);
		if(shouldPrep){
			prepQuestion(game);
		}
	},
	checkplayers: function(message, args, rank){
		let room = args.length > 1 ? toId(args[1]) : message.room;
    let response = "uh oh";
    if(!room){
      response = "You must specify a room.";
    }else if(!self.data.games[room]){
      response = "There is no game in " + room + ".";
    }else{
			let players = self.data.games[room].players;
			if(players.length === 0){
				response = "There are no players in the game.";
			}else{
				response = "These are the players in the game: " + players.map(item=>{return item.displayName}).join(", ");
			}
    }
    chat.js.reply(message, response);
	},
	startgame: function(message, args, rank){
		let room = args.length > 1 ? toId(args[1]) : message.room;
		let response = "uh oh";
		let success = false;
		let game = self.data.games[room];
		if(!room){
			response = "You must specify a room for the game.";
		}else if(!auth.js.rankgeq(rank, GAME_RANK)){
			response = "Your rank is not high enough to start a game.";
		}else if(!game){
			response = "There is no game in " + room + ".";
		}else{
			success = true;
			startRound(game);
		}
		if(!success){
			chat.js.reply(message, response);
		}
	},
	setcategories: function(message, args, rank){
		let response = "Your rank is not high enough to change the category.";
		if(auth.js.rankgeq(rank, GAME_RANK) && args.length > 1){
			response = "There is no game in " + message.room;
			let game = self.data.games[message.room];
			if(game){
				game.categories = args.slice(1).map((item)=>{
					return toId(item);
				}).filter((item)=>{
					return item ? true : false;
				});
				if(!game.categories.length){
					response = "There is no filter on the categories";
				}else{
					response = "The categories are now: " + game.categories.join(", ") + "."
				}
			}
		}
		chat.js.reply(message, response);
	},
	help: function(message, args, rank){
		chat.js.reply(message, "https://drive.google.com/file/d/0B8KyGlawfHaKV19IekhPZFZXTUU/view");
	}
};
let wllcommands = {
	check: function(message, args, rank){
		let username = args[1] && toId(args[1]) ? args[1] : message.user;
		getId(username, false, (user)=>{
      if(!user){
        chat.js.reply(message, username + " does not have a leaderboard entry.");
      }else{
        getEntryById(user.id, (entry)=>{
  				if(!entry){
  					chat.js.reply(message, user.display_name + " does not have an entry in the leaderboard.");
  				}else{
  					chat.js.reply(message, user.display_name + "'s stats: correct answers: "+ entry.correct + ", incorrect answers: " + entry.incorrect + ", passes: " + entry.passed + ", wins: " + entry.wins + ", total amount banked: $" + entry.banked + ", total amount won: $" + entry.won + ".");
  				}
  			}, (err)=>{
  				error(err);
  				chat.js.reply(message, "Something went wrong getting " + user.display_name + "'s stats.");
  			});
      }
		}, (err)=>{
			error(err);
			chat.js.reply(message, "Something went wrong getting the user's info.");
		});
	},
	remove: function(message, args, rank){

	}
}
let questioncommands = {
  add: function(message, args, rank, qwrank){
		let response = "what";
		if(!auth.js.rankgeq(qwrank,QUESTION_RANK)){
			response = "Your rank is not high enough to use that command.";
		}else if(args.length<3){
			response = "You must give the category, the question, and at least one answer.";
		}else{
			let question = args[1].trim();
			let answers = args.slice(2).map(item=>{return toId(item)});
			self.data.questions.regular.push({
				question: question,
				answers: answers
			});
			saveQuestions();
			response = "Successfully added the question: " + question;
		}
		chat.js.reply(message, response);
  },
	export: function(message, args, rank, qwrank){
		if(auth.js.rankgeq(qwrank,QUESTION_RANK)){
			let text;
			if(args.length > 1 && args[1] === "final"){
				text = self.data.questions.final.map(item=>{
					return item.category + " ; " + item.question + " ; " + item.answers.join(" ; ");
				}).join("\n");
			}else if(args.length > 1 && args[1] === "regular"){
				text = self.data.questions.regular.map(item=>{
					return item.category + " ; " + item.question + " ; " + item.answers.join(" ; ");
				}).join("\n");
			}else{
				chat.js.reply(message, "You must specify either 'regular' or 'final'.");
				return;
			}
			request.post({url:'https://hastebin.com/documents', body: text}, function(err,httpResponse,body){
				chat.js.pm(message.user, "hastebin.com/" + JSON.parse(body).key);
			});
		}
	},
	import: function(message, args, rank, qwrank){
		let response = "oops";
		let success = false;
		if(!auth.js.rankgeq(qwrank,QUESTION_RANK)){
			response = "You rank is not high enough to import questions.";
		}else if(args.length < 2){
			response = "You must give a link to the questions.";
		}else if(/^(https?:\/\/)?(www\.)?hastebin.com\/raw\/[a-z]+$/.test(args[1])){
			success = true;
			let response = "oops again";
			request.get(args[1],function(error, response, body){
				if(error){
						info(error);
						chat.js.reply(message, error);
						return;
				}
				let questions = body.split("\n");
				let newQuestions = [];
				for(let i=0;i<questions.length;i++){
					let arr = questions[i].split(";").map(item=>{return item.trim()});
					if(arr.length > 2){
						let cat = arr[0];
						let q = arr[1];
						let a = arr.slice(2).map(item=>{return toId(item)});
						if(cat && q && a && a.length){
							newQuestions.push({
								category: cat,
								question: q,
								answers: a
							});
						}
					}
				}
				if(newQuestions.length === 0){
					response = "No valid questions were found.";
				}else{
					if(args.length > 2 && args[2] === "final"){
						self.data.questions.final = self.data.questions.final.concat(newQuestions);
					}else if(args.length > 2 && args[2] === "regular"){
						self.data.questions.regular = self.data.questions.regular.concat(newQuestions);
					}else{
						chat.js.reply(message, "You must specify either 'regular' or 'final'.");
						return;
					}
					saveQuestions();
					response = "Imported " + newQuestions.length + " question" + (newQuestions.length === 1 ? "" : "s") + ", there are now " + self.data.questions.regular.length + " regular questions and " + self.data.questions.final.length + " final questions.";
				}
				chat.js.reply(message, response);
			});
		}else{
			response = "There was something wrong with your link, make sure it's only the raw paste.";
		}
		if(!success){
			chat.js.pm(message.user, response);
		}
	},
	overwrite: function(message, args, rank, qwrank){
		let response = "oops";
		let success = false;
		if(!auth.js.rankgeq(qwrank, QUESTION_RANK)){
			response = "You rank is not high enough to overwrite the questions.";
		}else if(args.length < 2){
			response = "You must give a link to the new questions.";
		}else if(/^(https?:\/\/)?(www\.)?hastebin.com\/raw\/[a-z]+$/.test(args[1])){
			success = true;
			let response = "oops again";
			request.get(args[1],function(error, response, body){
				if(error){
						info(error);
						chat.js.reply(message, error);
						return;
				}
				let questions = body.split("\n");
				let newQuestions = [];
				for(let i=0;i<questions.length;i++){
					let arr = questions[i].split(";").map(item=>{return item.trim()});
					if(arr.length > 2){
						let cat = arr[0]
						let q = arr[1];
						let a = arr.slice(2).map(item=>{return toId(item)});
						if(cat && q && a && a.length){
							newQuestions.push({
								category: cat,
								question: q,
								answers: a
							});
						}
					}
				}
				if(newQuestions.length === 0){
					response = "No valid questions were found.";
				}else{
					if(args.length > 2 && args[2] === "final"){
						self.data.questions.final = newQuestions;
					}else if(args.length > 2 && args[2] === "regular"){
						self.data.questions.regular = newQuestions;
					}else{
						chat.js.reply(message, "You must specify either 'regular' or 'final'.")
						return;
					}
					saveQuestions();
					response = "Overwrote questions, there are now " + newQuestions.length + " questions.";
				}
				chat.js.pm(message.user, response);
			});
		}else{
			response = "There was something wrong with your link, make sure it's only the raw paste.";
		}
		if(!success){
			chat.js.reply(message, response);
		}
	},
	load: function(message, args, rank, qwrank){
		if(auth.js.rankgeq(qwrank,QUESTION_RANK)){
			loadQuestions();
			chat.js.reply(message, "Reloaded the questions.");
		}
	},
	save: function(message, args, rank, qwrank){
		if(auth.js.rankgeq(qwrank,QUESTION_RANK)){
			saveQuestions();
			chat.js.reply(message, "Saved the questions.");
		}
	},
	num: function(message, args, rank, qwrank){
		chat.js.reply(message, "Regular questions: " + self.data.questions.regular.length + ", Final questions: " + self.data.questions.final.length);
	},
}

let getRoundTime = function(game){
	return 140+game.players.length*20;
}

let startRound = function(game){
	clearTimers(game);
	if(game.players.length === 1){
		chat.js.say(game.room, "The only player left is " + game.players[0].displayName + ". They probably win or something.");
	}else if(game.players.length === 0){
		chat.js.say(game.room, "There are no players left. Something terrible has happened.");
	}else if(game.players.length === 2 || game.finalists && game.finalists.length){
		if(!game.finalists){
			game.finalists = [game.players[0], game.players[1]];
		}
		startFinal(game);
	}else{
		chat.js.say(game.room, "Round " + game.round + " is starting. " + game.players[game.active].displayName + "'s question will be asked in " + BANK_TIME + " seconds.");
		game.bankTimer = setTimeout(()=>{
			askQuestion(game);
		}, BANK_TIME*1000);
		game.roundTimer = setTimeout(()=>{
			endRound(game);
		}, getRoundTime(game)*1000);
	}
}

let prepQuestion = function(game){
	game.canBank = true;
	game.active++;
	if(game.active >= game.players.length){
		game.active = 0;
	}
	game.question = null;
	chat.js.say(game.room, "It is " + game.players[game.active].displayName + "'s turn to answer. You have " + BANK_TIME + " seconds to bank before the question is asked.");
	game.bankTimer = setTimeout(()=>{
		askQuestion(game);
	}, BANK_TIME*1000);
}

let askQuestion = function(game){
	game.canBank = false;
	if(game.bankTimer){
		clearTimeout(game.bankTimer);
		game.bankTimer = null;
	}
	if(game.questions.length === 0){
		game.questions = self.data.questions.regular.slice();
	}
	let index = Math.floor(Math.random()*game.questions.length);
	game.question = game.questions.splice(index,1)[0];
	chat.js.say(game.room, "**" + game.players[game.active].displayName + ": " + game.question.question + "**")
}

let endRound = function(game){
	game.question = null;
	game.canBank = false;
	game.pot = 0;
	if(game.bankTimer){
		clearTimeout(game.bankTimer);
		game.bankTimer = null;
	}
	if(game.roundTimer){
		clearTimeout(game.roundTimer);
		game.roundTimer = null;
	}
	game.canVote = true;
	chat.js.say(game.room, "**The round is over. PM your votes for the weakest link to me with ~vote [user].**");
}

let onVote = function(game){
	if(game.canVote){
		let allVoted = true;
		for(let i=0;i<game.players.length;i++){
			if(!game.votes[game.players[i].id]){
				allVoted = false;
			}
		}
		if(allVoted){
			endVoting(game);
		}
	}
}

let endVoting = function(game){
	game.canVote = false;
	let strengths = game.players.slice().sort((i1,i2)=>{
		if(i1.correctAnswers === i2.correctAnswers){
			return i1.banked > i2.banked ? -1 : 1;
		}else{
			return i1.correctAnswers > i2.correctAnswers ? -1 : 1
		}
	});
	let first = strengths[0];
	let second = strengths[1];
	let votes = {};
	for(let vote in game.votes){
		let id = game.votes[vote];
		if(!votes[id]){
			votes[id] = 1;
		}else{
			votes[id]++;
		}
	}
	let weakest = [];
	for(let id in votes){
		weakest.push({
			id: id,
			num: votes[id]
		});
	}
	weakest.sort((i1,i2)=>{return i1.num>i2.num ? -1 : 1});

	for(let i=0;i<game.players.length;i++){
		game.players[i].banked = 0;
		game.players[i].correctAnswers = 0;
	}

	let weakestLink = weakest.filter(item=>{return item.num === weakest[0].num});
	if(weakestLink.length === 1){
		let player = game.players.filter(item=>{return item.id === weakestLink[0].id})[0];
		game.players.splice(game.players.indexOf(player), 1);
		if(game.players.indexOf(first) !== -1){
			game.active = game.players.indexOf(first);
		}else{
			game.active = game.players.indexOf(second);
		}
		game.votes = {};
		game.round++;


		chat.js.say(game.room, "The votes are in... " + player.displayName + ", you are the weakest link. Goodbye!");
		if(game.players.length === 1){
			chat.js.say(game.room, "The only player left is " + game.players[0].displayName + ". They probably win or something.");
		}else if(game.players.length === 0){
			chat.js.say(game.room, "There are no players left. Something terrible has happened.");
		}else{
			if(game.players.length === 2){
				if(game.active === 0){
					game.finalists = [game.players[0], game.players[1]];
				}else{
					game.finalists = [game.players[1], game.players[0]];
				}
				game.active = 0;
				chat.js.say(game.room, "There are two players left, the head-to-head round will begin in " + BREAK_TIME + " seconds. " + game.finalists[0].displayName + " will be first.");
			}else{
				chat.js.say(game.room, "The next round will start in " + BREAK_TIME + " seconds, and it will be " + game.players[game.active].displayName + "'s turn to answer.");
			}
			game.breakTimer = setTimeout(()=>{
				startRound(game);
			}, BREAK_TIME*1000);
		}
	}else{
		//Strongest link must decide.
		chat.js.say(game.room, "There was a tie in the voting. " + first.displayName + ", since you were the strongest link, you must decide which player to remove: " + weakestLink.map(item=>{return item.id}).join(","));
		game.weakest = weakestLink;
		game.strongest = first;
		game.second = second;
	}
}

let startFinal = function(game){
	chat.js.say(game.room, "The final round is starting. " +  game.finalists[0].displayName + "'s question will be asked in " + FINAL_BREAK + " seconds.");
	game.bankTimer = setTimeout(()=>{
		finalAskQuestion(game);
	}, FINAL_BREAK*1000);
	game.questions = self.data.questions.final.slice();
	game.questionsAsked = 0;
}

let finalAskQuestion = function(game){
	//Ask the qusetion, and set a timeout for finalAnswerQuestion(game)
	if(game.bankTimer){
		clearTimeout(game.bankTimer);
		game.bankTimer = null;
	}
	if(game.questions.length === 0){
		game.questions = self.data.questions.final.slice();
	}
	let index = Math.floor(Math.random()*game.questions.length);
	game.question = game.questions.splice(index,1)[0];
	chat.js.say(game.room, "**" + game.finalists[game.active].displayName + ": " + game.question.question + "**")
	game.questionTimer = setTimeout(()=>{
		finalAnswerQuestion(game);
	},QUESTION_TIME*1000);
};

let finalAnswerQuestion = function(game, answer){
	//Say correct/incorrect, give score update, and either end the game or set timeout for next question
	//If answer is not a string, the time ran out.
	let response = "";
	if(game.questionTimer){
		clearTimeout(game.questionTimer);
		game.questionTimer = null;
	}
	if(answer){
		let correct = false;
		for(let i=0;i<game.question.answers.length;i++){
			let cAnswer = game.question.answers[i];
			if(answer === cAnswer || cAnswer.length > 5 && levenshtein(answer,cAnswer) < 3){
				correct = true;
				break;
			}
		}
		if(correct){
			response = "Correct. ";
			game.finalists[game.active].correctAnswers++;
			updateUser(game.finalists[game.active].id, (entry)=>{
				entry.correct++;
				return entry;
			});
		}else{
			response = "Incorrect. ";
			updateUser(game.finalists[game.active].id, (entry)=>{
				entry.incorrect++;
				return entry;
			});
		}
	}else{
		response = "Time's up. ";
	}
	if(game.active === game.finalists.length - 1){
		game.active = 0;
		game.questionsAsked++;
	}else{
		game.active++;

	}


	let order = game.finalists.slice().sort((i1, i2)=>{
		return i1.correctAnswers > i2.correctAnswers ? -1 : 1;
	});
	let diff = order[0].correctAnswers - order[1].correctAnswers;
	if(diff + game.questionsAsked > 5 && diff > 0){
		response += order[0].displayName + " has beaten " + order[1].displayName + " " + order[0].correctAnswers + " to " + order[1].correctAnswers + ".";
		chat.js.say(game.room, response);
		updateUser(game.finalists[game.active].id, (entry)=>{
			entry.wins++;
			entry.won+=game.bank;
			return entry;
		});
		return;
	}
	response += "The score is " + order[0].correctAnswers + ":" + order[1].correctAnswers + " for " + order[0].displayName + ". ";
	response += game.finalists[game.active].displayName + "'s question will be asked in " + FINAL_BREAK + " seconds.";
	chat.js.say(game.room, response);
	game.bankTimer = setTimeout(()=>{
		finalAskQuestion(game);
	}, FINAL_BREAK*1000);
};

let clearTimers = function(game){
	if(game.bankTimer){
		clearTimeout(game.bankTimer);
		game.bankTimer = null;
	}
	if(game.roundTimer){
		clearTimeout(game.roundTimer);
		game.roundTimer = null;
	}
	if(game.voteTimer){
		clearTimeout(game.voteTimer);
		game.voteTimer = null;
	}
	if(game.questionTimer){
		clearTimeout(game.questionTimer);
		game.questionTimer = null;
	}
};

let saveQuestions = function(){
  let path = "data/questions.json";
  fs.writeFile(path,JSON.stringify(self.data.questions, null, "\t"), function(){
		//fs.closeSync(file);
	});
};

let loadQuestions = function(){
  let path = "data/questions.json";
	if(fs.existsSync(path)){
		self.data.questions = JSON.parse(fs.readFileSync(path, 'utf8'));
	}
	for(let i=0;i<self.data.questions.regular.length;i++){
		if(!self.data.questions.regular[i].category){
			self.data.questions.regular[i].category = "trivia";
		}
	}
};

let defaultConfigs = {
	startGameRank: "+",
	endGameRank: "%"
};

exports.defaultConfigs = defaultConfigs;

let configTypes = {
	startGameRank: "rank",
	endGameRank: "rank"
};

exports.configTypes = configTypes;

let levenshtein = function (s, t, l) { // s = string 1, t = string 2, l = limit
		// Original levenshtein distance function by James Westgate, turned out to be the fastest
		let d = []; // 2d matrix

		// Step 1
		let n = s.length;
		let m = t.length;

		if (n === 0) return m;
		if (m === 0) return n;
		if (l && Math.abs(m - n) > l) return Math.abs(m - n);

		// Create an array of arrays in javascript (a descending loop is quicker)
		for (let i = n; i >= 0; i--) d[i] = [];

		// Step 2
		for (let i = n; i >= 0; i--) d[i][0] = i;
		for (let j = m; j >= 0; j--) d[0][j] = j;

		// Step 3
		for (let i = 1; i <= n; i++) {
			let s_i = s.charAt(i - 1);

			// Step 4
			for (let j = 1; j <= m; j++) {
				// Check the jagged ld total so far
				if (i === j && d[i][j] > 4) return n;

				let t_j = t.charAt(j - 1);
				let cost = (s_i === t_j) ? 0 : 1; // Step 5

				// Calculate the minimum
				let mi = d[i - 1][j] + 1;
				let b = d[i][j - 1] + 1;
				let c = d[i - 1][j - 1] + cost;

				if (b < mi) mi = b;
				if (c < mi) mi = c;

				d[i][j] = mi; // Step 6
			}
		}

		// Step 7
		return d[n][m];
	};
