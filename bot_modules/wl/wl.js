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
  if(!onError){
		onError = (err)=>{
			error(err.message);
		};
	}
	if(!self.data.connected){
		onError("The bot is not connected to the database.");
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
	runSql(GET_ENTRY_SQL, [id], (row)=>{
		res = row;
	}, ()=>{
		onEnd(res);
	}, onError);
}

let getEntryByName = function(username, onEnd, onError){
	let res;
	getId(username, false, (user)=>{
    if(user){
      getEntryById(user.id, (res)=>{
        onEnd(res);
      }, onError);
    }else{
      onEnd(null);
    }
  }, onError);
}

let updateEntry = function(entry, onEnd, onError){
	runSql(UPDATE_ENTRY_SQL, [entry.id, entry.correct, entry.incorrect, entry.passed, entry.wins, entry.banked, entry.won], onEnd, onError);
}

let insertEntry = function(entry, onEnd, onError){
	runSql(INSERT_ENTRY_SQL, [entry.id, entry.correct, entry.incorrect, entry.passed, entry.wins, entry.banked, entry.won], onEnd, onError);
}

let updateById = function(id, updateFunc, onEnd, onError){
	getEntryById(id, (res)=>{
		if(!res){
			res = {id: id, correct: 0, incorrect: 0, passed: 0, wins: 0, banked: 0, won: 0};
			insertEntry(updateFunc(res), onEnd, onError);
		}else{
			updateEntry(updateFunc(res), onEnd, onError);
		}
	}, onError);
}

let updateByUsername = function(username, updateFunc, onEnd, onError){
	getId(username, true, (user)=>{
		updateById(user.id, updateFunc, onEnd, onError);
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
				}else{
					messageListener(m);
				}
			}
		}
	};

  self.messagehooks = {
	};
};

exports.onUnload = function(){
	saveQuestions();
  for(let room in self.data.games){
    endGame(room);
  }
};

exports.refreshDependencies = function(){
	rooms = getModuleForDependency("rooms", "wl");
	auth = getModuleForDependency("auth", "wl");
	chat = getModuleForDependency("chat", "wl");
};

exports.onConnect = function(){

};

let messageListener = function(m){
	let game = self.data.games[m.room];
	if(game){
    let text = toId(m.message);
    let id = toId(m.user)
    if(!game.hasStarted && game.players.length < game.maxplayers && text === "mein" && !getPlayerById(game, id)){
      addPlayer(game, id);
      if(game.joinTimer){
        clearTimeout(game.joinTimer);
      }
      game.joinTimer = setTimeout(()=>{
        game.joinTimer = null;
        let numPlayers = game.players.length;
        chat.js.say(game.room, "There " + (numPlayers === 1 ? "is" : "are") + " now " + numPlayers + " player" + (numPlayers === 1 ? "" : "s") + " in the game.");
      }, 5000);
    }
	}
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
		let room = message.room;
		let game = self.data.games[room];
		let success = false;
		let isHost = auth.js.rankgeq(rank, self.config.gameManageRank);
		if(!message.room){
			chat.js.reply(message, "You shouldn't be using this through PM.");
		}else if(!game){
			chat.js.reply(message, "There is no game in this room");
		}else if(!game.question){
			chat.js.reply(message, "There is no question right now.");
		}else if((!game.players || game.players[0].id !== toId(message.user) && !isHost)){
      chat.js.reply(message, "You can't use that command right now.");
    }else{
			game.pot = 0;
      if(game.isFinal){
        finalAnswerQuestion(game, false, "You have passed. ");
        return;
      }
			updateByUsername(game.players[0].id, (entry)=>{
				entry.passed++;
				return entry;
			});
      rotatePlayers(game);
			prepQuestion(game, "The pot is now empty. ");
		}
  },
  bank: function(message, args, rank){
		let room = message.room;
		let game = self.data.games[room];
    if(!room){
      chat.js.reply(message, "This cannot be done through PM.");
    }else if(!game){
      chat.js.reply(message, "There is no game in " + room + ".");
    }else if(!game.canBank){
			chat.js.reply(message, "You cannot bank at this time.");
		}else if(game.players[0].id !== toId(message.user)){
      chat.js.reply(message, "You are not the active player.");
    }else if(game.pot === 0){
			chat.js.say(room, "The pot is empty.");
		}else{
      let amount = POT_AMOUNTS[game.pot];
			game.bank+=amount;
			game.players[0].banked+=amount;
			game.pot = 0;
			chat.js.say(room, "The pot has been banked. There is now $" + game.bank + " in the bank.");
      updateByUsername(game.players[0].id, (entry)=>{
        entry.banked+=amount;
        return entry;
      });
    }
  },
	checkbank: function(message, args, rank){
		let room = message.room || toRoomId(args[0]);
		let game = self.data.games[room];
    chat.js.reply(message, game ? "There is $" + game.bank + " in the bank." : "There is no game in " + room + ".");
	},
	addbank: function(message, args, rank){
		let room = args.length > 1 ? toRoomId(args[1]) : message.room;
    let response = "uh oh";
		if(args.length === 0){
			response = "You must specify the amount to add.";
		}else if(!room){
      response = "You must specify a room for the game.";
    }else if(!auth.js.rankgeq(rank, self.config.gameManageRank)){
      response = "Your rank is not high enough to add money to the bank.";
    }else if(!self.data.games[room]){
      response = "There is no game in " + room + ".";
    }else if(!/^-?\d+$/.test(args[0])){
			response = "The amount to add must be an integer.";
		}else{
			let game = self.data.games[room];
			game.bank+=Number(args[0]);
      if(game.bank < 0) game.bank = 0;
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
		}else if(!auth.js.rankgeq(rank, self.config.gameManageRank)){
			response = "Your rank is not high enough to add money to the bank.";
		}else if(!self.data.games[room]){
			response = "There is no game in " + room + ".";
		}else if(!/^\d+$/.test(args[0])){
			response = "The amount must be a nonnegative integer.";
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
		}else if(!game){
			response = "There is no game in this room";
		}else if(!game.question){
			response = "There is no question right now.";
		}else if(args.length === 0){
			response = "You need to give an answer.";
		}else{
			let player = getPlayerById(game, id);
			if(!player){
				response = "You are not in the game.";
			}else if(player !== game.players[0]){
				response = "You are not the active player.";
			}else{
				let answer = toId(args[0]);
				success = true;
				let correct = false;
        let preamble;
				for(let i=0;i<game.question.answers.length;i++){
					let cAnswer = game.question.answers[i];
					if(answer === cAnswer || cAnswer.length > 5 && levenshtein(answer,cAnswer) < 3){
						correct = true;
						break;
					}
				}
				if(correct){
          if(game.isFinal){
  					finalAnswerQuestion(game, correct, "Correct. ");
  					return;
  				}
					player.correctAnswers++;
					game.pot++;
					if(game.pot === POT_AMOUNTS.length-1 && !game.isFinal){
						chat.js.say(game.room, "Correct, there is now " + POT_AMOUNTS[game.pot] + " in the pot. It will be automatically banked and the round will end.");
						game.bank+=POT_AMOUNTS[game.pot];
						game.pot = 0;
						updateByUsername(player.id, (entry)=>{
							entry.correct++;
							entry.banked+=POT_AMOUNTS[POT_AMOUNTS.length-1];
							return entry;
						});
						endRound(game);
						return;
					}else{
						preamble = "Correct, there is now $" + POT_AMOUNTS[game.pot] + " in the pot. ";
						updateByUsername(player.id, (entry)=>{
							entry.correct++;
							return entry;
						});
					}
				}else{
          if(game.isFinal){
  					finalAnswerQuestion(game, correct, "Incorrect. ");
  					return;
  				}
					preamble = "Incorrect, the pot is now empty. ";
					game.pot = 0;
					updateByUsername(player.id, (entry)=>{
						entry.incorrect++;
						return entry;
					});
				}
        rotatePlayers(game);
				prepQuestion(game, preamble);
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
				if(getPlayerById(testGame, id)){
					game = testGame;
					break;
				}
			}
			if(!game){
				response = "You are not playing any games of The Weakest Link.";
			}else if(!game.canVote){
				response = "It is not time to vote on the weakest link.";
			}else{
        if(!game.votes) game.votes = {};
				let player = getPlayerById(game, vote);
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
		let room = message.room || toRoomId(args[1]);
		let game = self.data.games[room];
		let id = toId(message.user);
    let isHost = auth.js.rankgeq(rank, self.config.gameManageRank)
		if(!game){
			chat.js.reply(message, "There is no game in " + room + ".");
		}else if(!game.strongest){
			chat.js.reply(message, "It is not time to decide the weakest link.");
		}else if(game.strongest[0].id !== id && !isHost){
			chat.js.reply(message, "You are not the strongest link.");
		}else{
			let decision = toId(args[0]);
      let options = game.weakest[0].players;
      let isOption = false;
      for(let i=0;i<options.length;i++){
        if(options[i].id === decision){
          isOption = true;
          break;
        }
      }
			if(!isOption){
				chat.js.reply(message, "That user is not an option.");
			}else{
				let player = getPlayerById(game, decision);
        removePlayer(game, decision);
				jumpToPlayer(game, id);
        game.round++;

        prepRound(game, player.displayName + ", you are the weakest link. Goodbye! ");
			}
		}
	}
};

let wlcommands = {
  newgame: function(message, args, rank){
    let room = args.length > 1 ? toRoomId(args[1]) : message.room;
    let response = "uh oh";
    let success = false;
    if(!room){
      response = "You must specify a room for the game.";
    }else if(!auth.js.rankgeq(rank, self.config.gameManageRank)){
      response = "Your rank is not high enough to start a game.";
    }else if(self.data.games[room]){
      response = "There is already a game in " + room + ".";
    }else{
      success = true;
      self.data.games[room] = {
				question: null,
				room: room,
        players: [],
        tempVoices: {},
				// votes: {},
				// strongest: [],
        // weakest: [],
        bank: 0,
				canBank: false,
				canVote: false,
        isFinal: false,
        hasStarted: false,
        modchat: false,
        pot: 0,
        round: 1,
				questions: [],
				bankTimer: null,
				roundTimer: null,
        breakTimer: null,
				questionTimer: null,
        joinTimer: null,
				categories: []
      }
      chat.js.say(room, "A game of The Weakest Link has started.");
    }
    if(!success){
      chat.js.reply(message, response);
    }
  },
  endgame: function(message, args, rank){
    let room = toRoomId(args[1]) || message.room;
    if(!room){
      chat.js.reply(message, "You must specify a room for the game.");
    }else if(!auth.js.rankgeq(rank, self.config.gameManageRank)){
      chat.js.reply(message, "Your rank is not high enough to end a game.");
    }else if(!self.data.games[room]){
      chat.js.reply(message, "There is no game in " + room + ".");
    }else{
			endGame(room);
      chat.js.say(room, "The game of The Weakest Link has been ended.");
    }
  },
	addplayer: "addplayers",
	addplayers: function(message, args, rank){
		let room = message.room;
		if(!room){
      chat.js.reply(message, "You cannot use this command through PM.");
		}else if(!auth.js.rankgeq(rank, self.config.gameManageRank)){
			chat.js.reply(message, "Your rank is not high enough to use that command.");
		}else if(!self.data.games[room]){
			chat.js.reply(message, "There is no game in " + room + ".");
		}else{
			let game = self.data.games[room];
			let prevCount = game.players.length;
			for(let i=1;i<args.length;i++){
				let id = toId(args[i]);
        addPlayer(game, id);
			}
      let added = game.players.length - prevCount;
      if(game.isFinal && game.players.length > 2){
        game.questions = null;
        game.isFinal = false;
        prepRound(game, "Added " + added + " player" + (added === 1 ? ". " : "s. "));
      }else{
        chat.js.say(room, "Added " + added + " player" + (added === 1 ? "." : "s."));
      }
		}
  },
	removeplayer: "removeplayers",
	removeplayers: function(message, args, rank){
		let room = message.room;
		let response = "uh oh";
		let game = self.data.games[room];
		let shouldPrep = false;
		if(args.length < 2){
			response = "You cannot use this command through PM.";
		}else if(!auth.js.rankgeq(rank, self.config.gameManageRank)){
			response = "Your rank is not high enough to use that command.";
		}else if(!self.data.games[room]){
			response = "There is no game in " + room + ".";
		}else{
			let num = game.players.length;
			let oldActive = game.players.length ? game.players[0].id : null;
			for(let i=1;i<args.length;i++){
        removePlayer(game, args[i]);
      }
			if(game.players.length && oldActive != game.players[0].id){
				if(game.roundTimer){
					if(game.bankTimer){
						clearTimeout(game.bankTimer);
						game.bankTimer = null;
					}
					shouldPrep = true;
				}
			}
			response = "Removed " + (num-game.players.length) + " player" + ((num-game.players.length) === 1 ? "." : "s.");
			if(game.canVote) onVote(game);
		}
    if(game.players.length < 2){
        prepRound(game);
        return;
    }
		chat.js.reply(message, response);
		if(shouldPrep){
			prepQuestion(game);
		}
	},
  maxplayers: function(message, args, rank){
    let room = message.room;
    let max = args[1] && /^\d+$/.test(args[1]) ? parseInt(args[1]) : 0;
		if(!room){
      chat.js.reply(message, "You cannot use this command through PM.");
		}else if(!auth.js.rankgeq(rank, self.config.gameManageRank)){
			chat.js.reply(message, "Your rank is not high enough to use that command.");
		}else if(!self.data.games[room]){
			chat.js.reply(message, "There is no game in " + room + ".");
		}else{
			let game = self.data.games[room];
			game.maxplayers = max;
      if(max === 0){
        chat.js.say(room, "Autojoin has been turned off.");
      }else{
        chat.js.say(room, "**Autojoin is now on! Type** ``**/me in**`` **to join! (wlsignups)**");
      }
		}
  },
	checkplayers: function(message, args, rank){
		let room = args.length > 1 ? toRoomId(args[1]) : message.room;
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
  modchat: function(message, args, rank){
    let room = toRoomId(args[2]) || message.room;
		if(!room){
      chat.js.reply(message, "You must specify the room to use this command through PM.");
		}else if(!auth.js.rankgeq(rank, self.config.gameManageRank)){
			chat.js.reply(message, "Your rank is not high enough to use that command.");
		}else if(!self.data.games[room]){
			chat.js.reply(message, "There is no game in " + room + ".");
		}else{
			let game = self.data.games[room];
      let arg = toId(args[1]);
      if(arg && arg === "on" || !arg && !game.modchat){
        if(!game.modchat){
          if(auth.js.rankgeq(auth.js.getTrueRoomRank(mainConfig.user, room), "@")){
            game.modchat = true;
            chat.js.say(room, "Modchat for the game is now on.");
            if(game.hasStarted){
              startModchat(game);
            }
          }else{
            chat.js.reply(message, "My rank is not high enough to support modchat.");
          }
        }else{
          chat.js.reply(message, "Modchat is already on for this game.");
        }
      }else if(arg && arg === "off" || !arg && game.modchat){
        if(game.modchat){
          if(game.hasStarted){
            endModchat(game);
          }
          game.modchat = false;
          chat.js.say(game.room, "Modchat for the game is now off.");
        }else{
          chat.js.reply(message, "Modchat is already off for this game.");
        }
      }
		}
  },
	startgame: function(message, args, rank){
		let room = toRoomId(args[1]) || message.room;
		let game = self.data.games[room];
		if(!room){
			chat.js.reply(message, "You must specify a room for the game.");
		}else if(!auth.js.rankgeq(rank, self.config.gameManageRank)){
			chat.js.reply(message, "Your rank is not high enough to start a game.");
		}else if(!game){
			chat.js.reply(message, "There is no game in " + room + ".");
		}else{
			prepRound(game);
		}
	},
  status: function(message, args, rank){
    let room = toRoomId(args[1]) || message.room;
    let game = self.data.games[room];
    if(!room){
      chat.js.reply(message, "You must specify a room for the game.");
    }else if(!auth.js.rankgeq(rank, self.config.gameManageRank)){
      chat.js.reply(message, "Your rank is not high enough to check the status.");
    }else if(!game){
      chat.js.reply(message, "There is no game in " + room + ".");
    }else if(game.canVote){
      chat.js.reply(message, "It is the voting peroid.");
    }else if(game.roundTimer){
      chat.js.reply(message, "It is the question answering peroid.");
    }else if(game.isFinal){
      chat.js.reply(message, "It is the final round.");
    }else if(game.strongest){
      chat.js.reply(message, "It is time for the strongest link to decide who is the weakest link.");
    }else if(game.breakTimer){
      chat.js.reply(message, "It is the break period before the next round.");
    }else if(!game.hasStarted){
      chat.js.reply(message, "The game has not started yet.");
    }else{
      chat.js.reply(message, "Dunno man.");
    }
  },
  endround: function(message, args, rank){
    let room = toRoomId(args[1]) || message.room;
		let game = self.data.games[room];
		if(!room){
			chat.js.reply(message, "You must specify a room for the game.");
		}else if(!auth.js.rankgeq(rank, self.config.gameManageRank)){
			chat.js.reply(message, "Your rank is not high enough to start a game.");
		}else if(!game){
			chat.js.reply(message, "There is no game in " + room + ".");
		}else if(!game.roundTimer && !game.questionTimer && !game.bankTimer){
      chat.js.reply(message, "It is not the question answering period.");
    }else{
			endRound(game);
		}
  },
  endvoting: function(message, args, rank){
    let room = toRoomId(args[1]) || message.room;
    let game = self.data.games[room];
    if(!room){
      chat.js.reply(message, "You must specify a room for the game.");
    }else if(!auth.js.rankgeq(rank, self.config.gameManageRank)){
      chat.js.reply(message, "Your rank is not high enough to start a game.");
    }else if(!game){
      chat.js.reply(message, "There is no game in " + room + ".");
    }else if(!game.canVote){
      chat.js.reply(message, "It is not the voting peroid.");
    }else{
      endVoting(game);
    }
  },
  prepround: function(message, args, rank){
    let room = toRoomId(args[1]) || message.room;
    let game = self.data.games[room];
    if(!room){
      chat.js.reply(message, "You must specify a room for the game.");
    }else if(!auth.js.rankgeq(rank, self.config.gameManageRank)){
      chat.js.reply(message, "Your rank is not high enough to start a game.");
    }else if(!game){
      chat.js.reply(message, "There is no game in " + room + ".");
    }else if(game.breakTimer || game.canVote || game.strongest || game.roundTimer){
      chat.js.reply(message, "Now's not a good time to prep for another round. Use ``~wl status`` to see what should be happening now.");
    }else{
      prepRound(game);
    }
  },
	setcategories: function(message, args, rank){
		let response = "Your rank is not high enough to change the category.";
		if(auth.js.rankgeq(rank, self.config.gameManageRank)){
			response = "There is no game in " + message.room;
			let game = self.data.games[message.room];
			if(game){
				game.categories = args.slice(1).map((item)=>{
					return toId(item);
				}).filter((item)=>{
					return item ? true : false;
				});
        game.questions = null;
        let regular = self.data.questions.regular.filter(item=>{return !game.categories.length || game.categories.indexOf(item.category) !== -1})
        let final = self.data.questions.final.filter(item=>{return !game.categories.length || game.categories.indexOf(item.category) !== -1});
				if(!game.categories.length){
					response = "There is no filter on the categories (" + regular.length + " regular questions, " + final.length + " final questions).";
				}else{
					response = "The categories are now: " + game.categories.join(", ") + " (" + regular.length + " regular questions, " + final.length + " final questions).";
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
		if(!auth.js.rankgeq(qwrank, self.config.questionManageRank)){
			response = "Your rank is not high enough to use that command.";
		}else if(args.length<4){
			response = "You must give the category, the question, and at least one answer.";
		}else{
      let category = toId(args[1]);
			let question = args[2].trim();
			let answers = args.slice(3).map(item=>{return toId(item)});
			self.data.questions.regular.push({
        category: category,
				question: question,
				answers: answers
			});
			saveQuestions();
			response = "Successfully added the question: " + question;
		}
		chat.js.reply(message, response);
  },
	export: function(message, args, rank, qwrank){
		if(auth.js.rankgeq(qwrank, self.config.questionManageRank)){
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
		if(!auth.js.rankgeq(qwrank, self.config.questionManageRank)){
			response = "You rank is not high enough to import questions.";
		}else if(args.length < 2){
			response = "You must give a link to the questions.";
		}else if(/^(https?:\/\/)?(www\.)?hastebin.com\/raw\/[a-z]+$/.test(args[1])){
			success = true;
			let response = "oops again";
			request.get(args[1],function(err, response, body){
				if(err){
						error(err);
						chat.js.reply(message, err);
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
				chat.js.pm(message.user, response);
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
		if(!auth.js.rankgeq(qwrank, self.config.questionManageRank)){
			response = "You rank is not high enough to overwrite the questions.";
		}else if(args.length < 2){
			response = "You must give a link to the new questions.";
		}else if(/^(https?:\/\/)?(www\.)?hastebin.com\/raw\/[a-z]+$/.test(args[1])){
			success = true;
			let response = "oops again";
			request.get(args[1],function(err, response, body){
				if(err){
						error(err);
						chat.js.reply(message, err);
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
		if(auth.js.rankgeq(qwrank, self.config.questionManageRank)){
			loadQuestions();
			chat.js.reply(message, "Reloaded the questions.");
		}
	},
	save: function(message, args, rank, qwrank){
		if(auth.js.rankgeq(qwrank, self.config.questionManageRank)){
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

let prepRound = function(game, preamble){
  preamble = preamble || "";
  if(!game) return;

  if(!game.hasStarted){
    game.hasStarted = true;
    if(game.modchat){
      startModchat(game);
    }
  }

  clearTimers(game);
  if(game.votes) delete game.votes;
  if(game.strongest) delete game.strongest;
  if(game.weakest) delete game.weakest;
  game.canVote = false;
  game.isFinal = false;
  for(let i=0;i<game.players.length;i++){
		game.players[i].banked = 0;
		game.players[i].correctAnswers = 0;
    game.players[i].answered = 0;
	}

  if(game.players.length < 2){
    chat.js.say(game.room, preamble + "There are not enough players to continue.");
  }else if(game.players.length === 2){
    chat.js.say(game.room, preamble + "There are two players left, the head-to-head round will begin in " + BREAK_TIME + " seconds.");
    game.questions = null;
    game.isFinal = true;
    game.breakTimer = setTimeout(()=>{
      startRound(game);
    }, BREAK_TIME*1000);
  }else{
    chat.js.say(game.room, preamble + "Round " + game.round + " will start in " + BREAK_TIME + " seconds, and it will be " + game.players[0].displayName + "'s turn to answer.");
    game.breakTimer = setTimeout(()=>{
      startRound(game);
    }, BREAK_TIME*1000);
  }

}

let startRound = function(game){
  if(!game) return;
	clearTimers(game);
  if(game.players.length < 2){
    chat.js.say(game.room, "There are not enough players to continue.");
  }else if(game.players.length === 2){
    game.isFinal = true;
    chat.js.say(game.room, "The final round is starting. " + game.players[0].displayName + "'s question will be asked in " + FINAL_BREAK + " seconds.");
  	game.bankTimer = setTimeout(()=>{
  		askQuestion(game);
  	}, FINAL_BREAK*1000);
  }else{
    chat.js.say(game.room, "Round " + game.round + " is starting. " + game.players[0].displayName + "'s question will be asked in " + BANK_TIME + " seconds.");
  	game.bankTimer = setTimeout(()=>{
  		askQuestion(game);
  	}, BANK_TIME*1000);
  	game.roundTimer = setTimeout(()=>{
  		endRound(game);
  	}, getRoundTime(game)*1000);
  }
}

let prepQuestion = function(game, preamble){
  preamble = preamble || "";
	game.canBank = true;
	game.question = null;
	chat.js.say(game.room, preamble + "It is " + game.players[0].displayName + "'s turn to answer. You have " + BANK_TIME + " seconds to bank before the question is asked.");
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
	populateQuestions(game);
	let index = Math.floor(Math.random()*game.questions.length);
	game.question = game.questions.splice(index,1)[0];
	chat.js.say(game.room, "**" + game.players[0].displayName + ": " + game.question.question + "**")
  if(game.isFinal){
    game.questionTimer = setTimeout(()=>{
  		finalAnswerQuestion(game, false, "Time's up. ");
  	},QUESTION_TIME*1000);
  }
}

let endRound = function(game){
	game.question = null;
	game.canBank = false;
	game.pot = 0;
	clearTimers(game);
	game.canVote = true;
  game.votes = {};
	chat.js.say(game.room, "**The round is over. The current players are: " + game.players.map(p=>{return p.displayName}).join(", ") + ". Please PM your votes for the weakest link to me with ~vote [user].**");
}

let onVote = function(game){
	if(game.canVote){
		let allVoted = true;
		for(let i=0;i<game.players.length;i++){
			if(!game.votes[game.players[i].id]){
				allVoted = false;
        break;
			}
		}
		if(allVoted){
			endVoting(game);
		}
	}
}

let endVoting = function(game){

  //Sorting the people by how string of a link they are
	game.strongest = game.players.slice().sort((i1,i2)=>{
		if(i1.correctAnswers === i2.correctAnswers){
			return i1.banked > i2.banked ? -1 : 1;
		}else{
			return i1.correctAnswers > i2.correctAnswers ? -1 : 1
		}
	});

  //Counting the votes
	let votes = {};
	for(let vote in game.votes){
		let id = game.votes[vote];
		if(!votes[id]){
			votes[id] = 1;
		}else{
			votes[id]++;
		}
	}

  //Creating the array of weakest players, sorted from most to fewest votes
	game.weakest = [];
	for(let id in votes){
    for(let i=0;i<=game.weakest.length;i++){
      if(!game.weakest[i] || game.weakest[i].numVotes < votes[id]){
        game.weakest.splice(i, 0, {numVotes: votes[id], players: [getPlayerById(game, id)]});
        break;
      }else if(game.weakest[i].numVotes === votes[id]){
        game.weakest[i].players.push(getPlayerById(game, id));
        break;
      }
    }
	}
  game.canVote = false;
	if(game.weakest[0].players.length === 1){
		let player = game.weakest[0].players[0];
    removePlayer(game, player.id);
		jumpToPlayer(game, game.strongest[0].id);
		game.round++;

		prepRound(game, "The votes are in... " + player.displayName + ", you are the weakest link. Goodbye! ");
	}else{
		//Strongest link must decide.
		chat.js.say(game.room, "There was a tie in the voting. " + game.strongest[0].displayName + ", since you were the strongest link, you must decide which player to remove: " + game.weakest[0].players.map(item=>{return item.displayName}).join(", "));
	}
}

let finalAnswerQuestion = function(game, correct, preamble){
	//Say correct/incorrect, give score update, and either end the game or set timeout for next question
	//If answer is not a string, the time ran out.
  game.question = null;
	let response = preamble || "";
	if(game.questionTimer){
		clearTimeout(game.questionTimer);
		game.questionTimer = null;
	}
  game.players[0].answered++;
  if(correct){
    game.players[0].correctAnswers++;
    updateByUsername(game.players[0].id, (entry)=>{
      entry.correct++;
      return entry;
    });
  }else{
    updateByUsername(game.players[0].id, (entry)=>{
      entry.incorrect++;
      return entry;
    });
  }

	let order = game.players.slice().sort((i1, i2)=>{
		return i1.correctAnswers > i2.correctAnswers ? -1 : 1;
	});
  info(order[0].id + ": " + order[0].correctAnswers + " correct, " + (order[0].answered - order[0].correctAnswers) + " incorrect.");
  info(order[1].id + ": " + order[1].correctAnswers + " correct, " + (order[1].answered - order[1].correctAnswers) + " incorrect.");
  let leeway = Math.max(0, 5-order[1].answered, order[0].answered - order[1].answered);
	if(order[0].correctAnswers > order[1].correctAnswers + leeway){
		response += order[0].displayName + " has beaten " + order[1].displayName + " " + order[0].correctAnswers + "-" + order[1].correctAnswers + ".";
		chat.js.say(game.room, response);
		updateByUsername(order[0].id, (entry)=>{
			entry.wins++;
			entry.won+=game.bank;
			return entry;
		});
	}else{
    rotatePlayers(game);
    response += "The score is " + order[0].correctAnswers + "-" + order[1].correctAnswers + " for " + order[0].displayName + ". ";
  	response += game.players[0].displayName + "'s question will be asked in " + FINAL_BREAK + " seconds.";
  	chat.js.say(game.room, response);
  	game.bankTimer = setTimeout(()=>{
  		askQuestion(game);
  	}, FINAL_BREAK*1000);
  }
};

let rotatePlayers = function(game){
  game.players.push(game.players.shift());
}

let jumpToPlayer = function(game, playerName){
  let id = toId(playerName);
  for(let i=0;i<game.players.length;i++){
    if(game.players[i].id === id){
      game.players = game.players.concat(game.players.splice(0,i));
      break;
    }
  }
}

let addPlayer = function(game, id){
  if(id){
    let displayName = rooms.js.getDisplayName(id, game.room);
    let player = getPlayerById(game, id);
    if(game.modchat && game.hasStarted){
      voice(game, id);
    }
    if(displayName && !player){
      game.players.push({
        id: id,
        displayName: displayName,
        banked: 0,
        correctAnswers: 0,
        answered: 0 //Only used for the final
      });
    }
  }
}

let removePlayer = function(game, playerName){
  //TODO move code detecting if a new round or question should be started Here
  // Deal with player being removed during final round.
  if(!game) return;
  let id = toId(playerName);
  //Remove from game.players
  game.players = game.players.filter(item=>{return item.id !== id});

  devoice(game, id);

  //Remove their vote if it existsSync, and votes for them
  if(game.votes){
    if(game.votes[id]) delete game.votes[id]
    for(let voter in game.votes){
      if(game.votes[voter] === id){
        delete game.votes[voter];
      }
    }
  }

  //Remove them from the strongest and weakest links
  if(game.strongest) game.strongest = game.strongest.filter(item=>{return item.id !== id});
  if(game.weakest){
    for(let i=0;i<game.weakest.length;i++){
      game.weakest[i].players = game.weakest[i].players.filter(item=>{return item.id !== id});
      if(game.weakest[i].players.length === 0){
        game.weakest.splice(i, 1);
        i--;
      }
    }
  }

}

let getPlayerById = function(game, id){
  if(!game) return;
  let player;
  for(let i=0;i<game.players.length;i++){
    if(game.players[i].id === id){
      player = game.players[i];
      break;
    }
  }
  return player;
}

let populateQuestions = function(game){
  if(!game.questions || !game.questions.length){
    if(game.isFinal){
      game.questions = self.data.questions.final.filter(item=>{return !game.categories.length || game.categories.indexOf(item.category) !== -1});
    }else{
      game.questions = self.data.questions.regular.filter(item=>{return !game.categories.length || game.categories.indexOf(item.category) !== -1});
    }
  }
}

let startModchat = function(game){
  voiceAll(game);
  chat.js.say(game.room, "/modchat +");
}

let endModchat = function(game){
  devoiceAll(game);
  if(game.modchat){
    chat.js.say(game.room, "/modchat ac");
  }
}

let voice = function(game, id){
  info("trying to voice " + id);
  info("True rank: '" + auth.js.getTrueRoomRank(id, game.room) + "'");
  info(auth.js.rankgeq(" ", auth.js.getTrueRoomRank(id, game.room)));
  if(game && game.modchat && id && !game.tempVoices[id] && auth.js.rankgeq(" ", auth.js.getTrueRoomRank(id, game.room))){
    game.tempVoices[id] = true;
    chat.js.say(game.room, "/roomvoice " + id);
  }
}

let voiceAll = function(game){
  if(game && game.modchat){
    for(let i=0;i<game.players.length;i++){
      let id = game.players[i].id;
      info("trying to voice " + id);
      info("True rank: '" + auth.js.getTrueRoomRank(id, game.room) + "'");
      info(auth.js.rankgeq(" ", auth.js.getTrueRoomRank(id, game.room)));
      if(!game.tempVoices[id] && auth.js.rankgeq(" ", auth.js.getTrueRoomRank(id, game.room))){
        game.tempVoices[id] = true;
        chat.js.say(game.room, "/roomvoice " + id);
      }
    }
  }
}

let devoice = function(game, id){
  if(game && id && game.tempVoices[id]){
    delete game.tempVoices[id];
    chat.js.say(game.room, "/roomdevoice " + id);
  }
}

let devoiceAll = function(game){
  if(game){
    for(let user in game.tempVoices){
      delete game.tempVoices[user];
      chat.js.say(game.room, "/roomdevoice " + user);
    }
  }
}

let endGame = function(room){
  let game = self.data.games[room];
  if(game){
    clearTimers(game);
    endModchat(game);
    delete self.data.games[room];
  }
}

let clearTimers = function(game){
	if(game.bankTimer){ //This timer gives time for a user to bank before their question.
		clearTimeout(game.bankTimer);
		game.bankTimer = null;
	}
	if(game.roundTimer){ //This timer is what ends a round.
		clearTimeout(game.roundTimer);
		game.roundTimer = null;
	}
  if(game.breakTimer){
    clearTimeout(game.breakTimer);
    game.breakTimer = null;
  }
	if(game.questionTimer){ //This timer determines how long you have to answer a question in the final.
		clearTimeout(game.questionTimer);
		game.questionTimer = null;
	}
  if(game.joinTimer){
    clearTimeout(game.joinTimer);
    game.joinTimer = null;
  }
};

let saveQuestions = function(){
  let path = "data/questions.json";
  fs.writeFileSync(path,JSON.stringify(self.data.questions, null, "\t"));
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
  for(let i=0;i<self.data.questions.final.length;i++){
		if(!self.data.questions.final[i].category){
			self.data.questions.final[i].category = "trivia";
		}
	}
};

let defaultConfigs = {
	gameManageRank: "%",
  questionManageRank: "%"
};

exports.defaultConfigs = defaultConfigs;

let configTypes = {
	gameManageRank: "rank",
  questionManageRank: "rank"
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
