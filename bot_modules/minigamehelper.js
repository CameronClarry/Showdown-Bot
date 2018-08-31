let fs = require("fs");
let self = {js:{},data:{},requiredBy:[],hooks:{},config:{}};
let auth = null;
let chat = null;

let duelPlayers = {};
let titanRegs = {};
let titanAuth = {};

exports.onLoad = function(module, loadData){
	self = module;
	self.js.refreshDependencies();

	if(loadData){
		self.data = {};
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
				}
			}
		},
	};
};
exports.onUnload = function(){

};
exports.refreshDependencies = function(){
	auth = getModuleForDependency("auth", "minigamehelper");
  chat = getModuleForDependency("chat", "minigamehelper");
};
exports.onConnect = function(){

};

let commands = {
  dap: "dueladdplayers",
  dueladdplayer: "dueladdplayers",
	dueladdplayers: function(message, args, rank){
		if(args.length>0 & auth.js.rankgeq(rank, self.config.rosterRank)){
      let added = 0;
      for(let i=0;i<args.length;i++){
        let id = toId(args[i]);
        if(!(id in duelPlayers)){
          duelPlayers[id] = args[i];
          added++;
        }
      }
      chat.js.reply(message, "Added " + added + " player(s) to the duel roster.");
		}
	},
  drp: "duelremoveplayers",
  duelremoveplayer: "duelremoveplayers",
  duelremoveplayers: function(message, args, rank){
		if(args.length>0 & auth.js.rankgeq(rank, self.config.rosterRank)){
      let removed = 0;
      for(let i=0;i<args.length;i++){
        let id = toId(args[i]);
        if(id in duelPlayers){
          delete duelPlayers[id];
          removed++;
        }
      }
      chat.js.reply(message, "Removed " + removed + " player(s) from the duel roster.");
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
  dl: "duellist",
  duellist: function(message, args, rank){
		if(args.length>0 & auth.js.rankgeq(rank, self.config.rosterRank)){
      let parray = [];
      for(let id in duelPlayers){
        parray.push(duelPlayers[id]);
      }
      if(toId(args[0]) === "html" && message.room === "trivia"){
        let message = "!htmlbox <table style=\"background-color: #45cc51; margin: 2px 0;border: 2px solid #0d4916\" border=1><tr style=\"background-color: #209331\"><th>Duel Players</th></tr>";
        message = message + "<tr><td><center>" + parray.join(", ") + "</center></td></tr>";
      	message = message + "</table>"

      	chat.js.say("trivia", message);
      }else{
        chat.js.reply(message, "The players in the duel are " + prettyList(parray.map((p)=>{return "__"+p+"__"})) + ".")
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
        let message = "!htmlbox <table style=\"background-color: #45cc51; margin: 2px 0;border: 2px solid #0d4916\" border=1><tr style=\"background-color: #209331\"><th>Regs</th><th>Auth</th></tr>";
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
  tl: "titanlist",
  titanlist: function(message, args, rank){
		if(args.length>0 & auth.js.rankgeq(rank, self.config.rosterRank)){
      duelPlayers = {};
      chat.js.reply(message, "Cleared the duel player list.");
    }
	},
  titanclear: function(message, args, rank){
		if(args.length>0 & auth.js.rankgeq(rank, self.config.rosterRank)){
      titanAuth = {};
      titanRegs = {};
      chat.js.reply(message, "Cleared the auth and reg lists.");
    }
	},
};

let defaultConfigs = {
	rosterRank: "%"
};

exports.defaultConfigs = defaultConfigs;

let configTypes = {
	rosterRank: "rank"
};

exports.configTypes = configTypes;
