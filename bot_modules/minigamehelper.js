let fs = require("fs");
let self = {js:{},data:{},requiredBy:[],hooks:{},config:{}};
let auth = null;
let chat = null;
let rooms = null;

let titanRegs = {};
let titanAuth = {};

exports.onLoad = function(module, loadData){
	self = module;
	self.js.refreshDependencies();

	if(loadData){
		self.data = {
			plist:[],
			maxplayers:0,
			voices:{},
			scores:{},
			shouldVoice: false
		};
	}

	self.chathooks = {
		chathook: function(m){
			if(m && !m.isInit){
				let text = m.message;
				if(text[0]==="~"){
					let command = text.split(" ")[0].trim().toLowerCase().substr(1);
					let chatArgs = text.substring(command.length+2, text.length).split(",");
					for(let i = 0;i<chatArgs.length;i++){
						chatArgs[i] = chatArgs[i].trim();
					}
					if(commands[command]&&auth&&auth.js){
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
		},
	};
};
exports.onUnload = function(){
	if(self.data.shouldVoice){
		for(let id in self.data.voices){
			chat.js.say("trivia", "/roomdeauth " + id);
		}
		chat.js.say("trivia", "/modchat ac");
	}
};
exports.refreshDependencies = function(){
	auth = getModuleForDependency("auth", "minigamehelper");
  chat = getModuleForDependency("chat", "minigamehelper");
  rooms = getModuleForDependency("rooms", "minigamehelper");
};
exports.onConnect = function(){

};

let messageListener = function(m){
	if(self.data.maxplayers && self.data.plist.length < self.data.maxplayers && m.room === "trivia"){
		let text = toId(m.message);
		if(text === "mein"){
			let nplayers = self.data.plist.length;
			addPlayers([m.user]);
			if(nplayers !== self.data.plist.length){
				if(self.data.joinTimer){
					clearTimeout(self.data.joinTimer);
				}
				self.data.joinTimer = setTimeout(()=>{
					self.data.joinTimer = null;
					let numPlayers = self.data.plist.length;
					chat.js.say("trivia", "There " + (numPlayers === 1 ? "is" : "are") + " now " + numPlayers + " player" + (numPlayers === 1 ? "" : "s") + " in the game.");
				}, 5000);
			}
		}
	}
};

let commands = {
	plmax: function(message, args, rank){
		let room = message.room;
		let max = args[0] && /^\d+$/.test(args[0]) ? parseInt(args[0]) : 0;
		if(!room){
			chat.js.reply(message, "You cannot use this command through PM.");
		}else if(!auth.js.rankgeq(rank, self.config.rosterRank) || self.data.voices[toId(message.user)]){
			chat.js.reply(message, "Your rank is not high enough to use the player list commands.");
		}else if(room !== "trivia"){
			chat.js.reply(message, "This command can only be used in Trivia.");
		}else{
			self.data.maxplayers = max;
			if(max === 0){
				chat.js.say("trivia", "Autojoin has been turned off.");
			}else{
				chat.js.say("trivia", "**Autojoin is now on! Type ``/me in`` to join!**");
			}
		}
	},
  //dap: "dueladdplayers",
  //dueladdplayer: "dueladdplayers",
	pladd: function(message, args, rank){
		if(!auth.js.rankgeq(rank, self.config.rosterRank) || self.data.voices[toId(message.user)]){
			chat.js.reply(message, "Your rank is not high enough to use the player list commands.");
		}else{
			let response = addPlayers(args);
			chat.js.reply(message, response);
		}
	},
  //drp: "duelremoveplayers",
  //duelremoveplayer: "duelremoveplayers",
  plremove: function(message, args, rank){
		if(!auth.js.rankgeq(rank, self.config.rosterRank) || self.data.voices[toId(message.user)]){
			chat.js.reply(message, "Your rank is not high enough to use the player list commands.");
		}else{
			let response = removePlayers(args);
			chat.js.reply(message, response);
		}
	},
  tar: "titanaddregs",
  titanaddreg: "titanaddregs",
	titanaddregs: function(message, args, rank){
		if(args.length>0 & auth.js.rankgeq(rank, self.config.rosterRank)){
      let added = 0;
      for(let i=0;i<args.length;i++){
        let id = toId(args[i]);
        if(!(id in titanRegs) && !(id in titanAuth)){
          titanRegs[id] = args[i];
          added++;
        }
      }
      chat.js.reply(message, "Added " + added + " player(s) to the titanomachy regs.");
		}
	},
  taa: "titanaddauth",
  titanaddauth: "titanaddauth",
	titanaddauth: function(message, args, rank){
		if(args.length>0 & auth.js.rankgeq(rank, self.config.rosterRank)){
      let added = 0;
      for(let i=0;i<args.length;i++){
        let id = toId(args[i]);
        if(!(id in titanAuth) && !(id in titanRegs)){
          titanAuth[id] = args[i];
          added++;
        }
      }
      chat.js.reply(message, "Added " + added + " player(s) to the titanomachy auth.");
		}
	},
  tr: "titanremove",
  titanremove: function(message, args, rank){
		if(args.length>0 & auth.js.rankgeq(rank, self.config.rosterRank)){
      let removed = 0;
      for(let i=0;i<args.length;i++){
        let id = toId(args[i]);
        if(id in titanRegs){
          delete titanRegs[id];
          removed++;
        }
        if(id in titanAuth){
          delete titanAuth[id];
          removed++;
        }
      }
      chat.js.reply(message, "Removed " + removed + " player(s) from the titanomachy roster.");
		}
	},
  pl: "pllist",
  pllist: function(message, args, rank){
    let parray = self.data.plist.map(e=>{return e.displayName});
		if(!parray || parray.length==0){
			chat.js.reply(message, "There are no players.");
		}else if(args.length>0 & auth.js.rankgeq(rank, self.config.rosterRank) && toId(args[0]) === "html" && message.room === "trivia"){
      let message = "/addhtmlbox <table style=\"background-color: #45cc51; margin: 2px 0;border: 2px solid #0d4916\" border=1><tr style=\"background-color: #209331\"><th>Players</th></tr>";
      message = message + "<tr><td><center>" + parray.join(", ") + "</center></td></tr>";
    	message = message + "</table>"

    	chat.js.say("trivia", message);
    }else if(args.length > 0 && toId(args[0]) === "nohl"){
      chat.js.reply(message, "The players in the game are " + prettyList(parray.map((p)=>{return "__"+p+"__"})) + ".")
    }else{
      chat.js.reply(message, "The players in the game are " + prettyList(parray.map((p)=>{return p})) + ".")
    }
	},
	plshuffle: function(message, args, rank){
		let plist = self.data.plist;
		if(!plist || plist.length==0){
			chat.js.reply(message, "There are no players.");
		}else if(args.length > 0 && toId(args[0]) === "nohl"){
			chat.js.reply(message, prettyList(shuffle(plist).map(item=>{return "__"+item.displayName+"__"})));
		}else{
			chat.js.reply(message, prettyList(shuffle(plist).map(item=>{return item.displayName})));
		}
	},
	plpick: function(message, args, rank){
		if(!auth.js.rankgeq(rank, self.config.rosterRank)){
			chat.js.reply(message, "Your rank is not high enough to use the player list commands.");
		}else{
			let plist = self.data.plist;
			if(!plist || plist.length==0){
				chat.js.reply(message, "There are no players.");
			}else if(args.length > 0 && toId(args[0]) === "nohl"){
				chat.js.reply(message, "I randomly picked: __" + plist[Math.floor(Math.random()*plist.length)].displayName + "__");
			}else{
				chat.js.reply(message, "I randomly picked: " + plist[Math.floor(Math.random()*plist.length)].displayName);
			}
		}
	},
  tl: "titanlist",
  titanlist: function(message, args, rank){
		if(args.length>0 & auth.js.rankgeq(rank, self.config.rosterRank)){
      let rarray = [];
      let aarray = [];
      for(let id in titanRegs){
        rarray.push(titanRegs[id]);
      }
      for(let id in titanAuth){
        aarray.push(titanAuth[id]);
      }
      if(toId(args[0]) === "html" && message.room === "trivia"){
        let message = "/addhtmlbox <table style=\"background-color: #45cc51; margin: 2px 0;border: 2px solid #0d4916\" border=1><tr style=\"background-color: #209331\"><th>Regs</th><th>Auth</th></tr>";
      	for(let i=0;i<Math.max(rarray.length, aarray.length);i++){
      		message = message + "<tr><td>" + (rarray[i] || "") + "</td><td>" + (aarray[i] || "") + "</td></tr>";
      	}
      	message = message + "</table>"

      	chat.js.say("trivia", message);
      }else{
        chat.js.reply(message, "Regs: " + prettyList(rarray.map((p)=>{return "__"+p+"__"})) + ".")
        chat.js.reply(message, "Auth: " + prettyList(aarray.map((p)=>{return "__"+p+"__"})) + ".")
      }
    }
	},
  //dc: "duelclear",
	clearpl: "plclear",
  plclear: function(message, args, rank){
		if(auth.js.rankgeq(rank, self.config.rosterRank) && !self.data.voices[toId(message.user)]){
      self.data.plist = [];
			self.data.scores = {};
			if(self.data.shouldVoice){
				for(let id in self.data.voices){
					chat.js.say("trivia", "/roomdeauth " + id);
				}
			}
			self.data.voices = {};
      chat.js.reply(message, "Cleared the player list.");
    }
	},
  titanclear: function(message, args, rank){
		if(auth.js.rankgeq(rank, self.config.rosterRank)){
      titanAuth = {};
      titanRegs = {};
      chat.js.reply(message, "Cleared the auth and reg lists.");
    }
	},
	addpoint: "addpoints",
	addpoints: function(message, args, rank){
		let player = toId(args[0])
		let points = parseInt(args[1], 10);
		if(!auth.js.rankgeq(rank, "+") || self.data.voices[toId(message.user)]){
			chat.js.reply(message, "Your rank is not high enough to add points.");
		}else if(!player || !points){
			chat.js.reply(message, "You must give a valid player and number of points.");
		}else{
			if(self.data.scores[player]){
				self.data.scores[player].score = self.data.scores[player].score + points;
			}else{
				self.data.scores[player] = {name: args[0], score: points};
			}
      chat.js.reply(message, self.data.scores[player].name + "'s score is now " + self.data.scores[player].score + ".");
    }
	},
	showpoints: function(message, args, rank){
		let player = toId(args[0]);
		if(player){
			let entry = self.data.scores[player];
			if(entry){
				chat.js.reply(message, entry.name + "'s score is " + entry.score + ".");
			}else{
				chat.js.reply(message, entry.name + " does not have a score.");
			}
		}else{
			let scores = [];
			for(let p in self.data.scores){
				scores.push(self.data.scores[p]);
			}
			scores.sort((e1,e2)=>{return e1.score < e2.score});
			if(scores.length == 0){
				chat.js.reply(message, "No one has any points.");
			}else{
				chat.js.reply(message, "The current scores are: " + scores.map(e=>{return "__" + e.name + "__ (" + e.score + ")"}).join(", "));
			}
		}
	},
  clearpoints: function(message, args, rank){
		if(auth.js.rankgeq(rank, self.config.rosterRank) && !self.data.voices[toId(message.user)]){
      self.data.scores = {};
      chat.js.reply(message, "Cleared the current scores.");
    }
	},
	modchat: function(message, args, rank){
		let arg = toId(args[0]);
		if(!auth.js.rankgeq(rank, "%")){
			chat.js.reply(message, "Your rank is not high enough to turn on modchat.");
		}else{
			if(arg === "on"){
				if(self.data.shouldVoice){
					chat.js.reply(message, "Modchat is already on.");
				}else{
					self.data.shouldVoice = true;
					for(let id in self.data.voices){
						chat.js.say("trivia", "/roomvoice " + id);
					}
					chat.js.say("trivia", "/modchat +");
				}
			}else if(arg === "off"){
				if(!self.data.shouldVoice){
					chat.js.reply(message, "Modchat is already off.")
				}else{
					self.data.shouldVoice = false;
					for(let id in self.data.voices){
						chat.js.say("trivia", "/roomdeauth " + id);
					}
					chat.js.say("trivia", "/modchat ac");
				}
			}
		}
	}
};

let addPlayers = function(names){
	if(names.length==0) return "Player list not updated. You must give at least one player.";
	if(!self.data.plist) self.data.plist = [];
	let plist = self.data.plist;
	for(let i=0;i<names.length;i++){
		let id = toId(names[i]);
		if(id==="") break;
		if(!self.data.voices[id] && rooms.js.getDisplayName(id, "trivia") && auth.js.getTrueRoomRank(id, "trivia") === " "){
			self.data.voices[id] = true;
			// The following lines would make things more convenient, but for security reasons they should not be included.
			// Theoretically, voices would be able to voice people under certain circumstances if they were uncommented.
			// if(self.data.shouldVoice){
			// 	chat.js.say("trivia", "/roomvoice " + id);
			// }
		}
		for(let j=0;j<plist.length+1;j++){
			if(j == plist.length){
				plist.push({id: id, displayName: removeRank(names[i])});
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
		if(self.data.voices[id]){
			delete self.data.voices[id];
			if(self.data.shouldVoice){
				chat.js.say("trivia", "/roomdeauth " + id);
			}
		}
		if(self.data.scores[id]) delete self.data.scores[id]
		self.data.plist = self.data.plist.filter(item=>{return item.id !== id});
	}
	let n = self.data.plist.length;
	return "Player list updated. There " + (n==1?"is":"are") + " now " + n + " player" + (n==1?"":"s") + "."
}

let defaultConfigs = {
	rosterRank: "+"
};

exports.defaultConfigs = defaultConfigs;

let configTypes = {
	rosterRank: "rank"
};

exports.configTypes = configTypes;
