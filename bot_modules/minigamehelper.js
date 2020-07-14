let fs = require("fs");
let self = {js:{},data:{},requiredBy:[],hooks:{},config:{}};
let data = {};
let config = defaultConfigs;

let tt = null;

const GOVERNING_ROOM = "trivia";
exports.GOVERNING_ROOM = GOVERNING_ROOM;

let titanRegs = {};
let titanAuth = {};

exports.onLoad = function(module, loadData, oldData){
	self = module;
	refreshDependencies();
	if(oldData) data = oldData;

	if(loadData){
		data = {
			plist:[],
			maxplayers:0,
			voices:{},
			scores:{},
			shouldVoice: false,
			hosts: {}
		};
	}

	if(!data.remindTimer && config.officialReminders){
		let timeDiff = (1457024400000-new Date().getTime())%14400000+14400000;
		data.remindTimer = setTimeout(()=>{
			data.remindTimer = null;
			officialReminder();
		}, timeDiff);
		info("Set the reminder for " + timeDiff/1000/60 + " minutes");
	}

	self.chathooks = {
		chathook: function(room, user, message){
			if(data.maxplayers && data.plist.length < data.maxplayers && room.id === "trivia"){
				let text = toId(message);
				if(text === "mein"){
					let nplayers = data.plist.length;
					addPlayers([user.id], room);
					if(nplayers !== data.plist.length){
						if(data.joinTimer){
							clearTimeout(data.joinTimer);
						}
						data.joinTimer = setTimeout(()=>{
							data.joinTimer = null;
							let numPlayers = data.plist.length;
							room.send("There " + (numPlayers === 1 ? "is" : "are") + " now " + numPlayers + " player" + (numPlayers === 1 ? "" : "s") + " in the game.");
						}, 5000);
					}
				}else if(text === "meout"){
					let nplayers = data.plist.length;
					removePlayers([user.id], room);
					if(nplayers !== data.plist.length){
						if(data.joinTimer){
							clearTimeout(data.joinTimer);
						}
						data.joinTimer = setTimeout(()=>{
							data.joinTimer = null;
							let numPlayers = data.plist.length;
							room.send("There " + (numPlayers === 1 ? "is" : "are") + " now " + numPlayers + " player" + (numPlayers === 1 ? "" : "s") + " in the game.");
						}, 5000);
					}
				}
			}
		},
	};
};
exports.onUnload = function(){
	let triviaRoom = RoomManager.getRoom("trivia");
	if(!triviaRoom) error("Minigamehelper unloaded, but wasn't in Trivia. Did any temporary voices get left behind?");
	if(data.shouldVoice){
		for(let id in data.voices){
			triviaRoom.send("/roomdeauth " + id);
		}
		triviaRoom.send("/modchat ac");
	}
	for(let id in data.hosts){
		triviaRoom.send("/roomdeauth " + id);
	}
	if(data.remindTimer){
		clearTimeout(data.remindTimer);
		data.remindTimer = null;
	}
};
let refreshDependencies = function(){
	tt = getModuleForDependency("tt", "minigamehelper");
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

let commands = {
	plmax: function(message, args, user, rank, room, commandRank, commandRoom){
		let max = args[0] && /^\d+$/.test(args[0]) ? parseInt(args[0]) : 0;
		if(!room){
			room.broadcast(user, "You cannot use this command through PM.", rank);
		}else if(!AuthManager.rankgeq(commandRank, config.rosterRank) || data.voices[user.id]){
			room.broadcast(user, "Your rank is not high enough to use the player list commands.", rank);
		}else if(room.id !== "trivia"){
			room.broadcast(user, "This command can only be used in Trivia.", rank);
		}else{
			data.maxplayers = max;
			if(max === 0){
				room.send("Autojoin has been turned off.");
			}else{
				room.send("**Autojoin is now on! Type ``/me in`` to join!**");
			}
		}
	},
	pladd: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, config.rosterRank) || data.voices[user.id]){
			room.broadcast(user, "Your rank is not high enough to use the player list commands.", rank);
		}else{
			let response = addPlayers(args, commandRoom);
			room.broadcast(user, response, rank);
		}
	},
	plremove: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, config.rosterRank) || data.voices[user.id]){
			room.broadcast(user, "Your rank is not high enough to use the player list commands.", rank);
		}else{
			let response = removePlayers(args);
			room.broadcast(user, response, rank);
		}
	},
	tar: "titanaddregs",
	titanaddreg: "titanaddregs",
	titanaddregs: function(message, args, user, rank, room, commandRank, commandRoom){
		if(args.length>0 & AuthManager.rankgeq(commandRank, config.rosterRank)){
			let added = 0;
			for(let i=0;i<args.length;i++){
				let id = toId(args[i]);
				if(!(id in titanRegs) && !(id in titanAuth)){
					titanRegs[id] = args[i];
					added++;
				}
			}
			room.broadcast(user, "Added " + added + " player(s) to the titanomachy regs.", rank);
		}
	},
	taa: "titanaddauth",
	titanaddauth: "titanaddauth",
	titanaddauth: function(message, args, user, rank, room, commandRank, commandRoom){
		if(args.length>0 & AuthManager.rankgeq(commandRank, config.rosterRank)){
			let added = 0;
			for(let i=0;i<args.length;i++){
				let id = toId(args[i]);
				if(!(id in titanAuth) && !(id in titanRegs)){
					titanAuth[id] = args[i];
					added++;
				}
			}
			room.broadcast(user, "Added " + added + " player(s) to the titanomachy auth.", rank);
		}
	},
	tr: "titanremove",
	titanremove: function(message, args, user, rank, room, commandRank, commandRoom){
		if(args.length>0 & AuthManager.rankgeq(commandRank, config.rosterRank)){
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
			room.broadcast(user, "Removed " + removed + " player(s) from the titanomachy roster.", rank);
		}
	},
	pl: "pllist",
	pllist: function(message, args, user, rank, room, commandRank, commandRoom){
    	let parray = data.plist.map(e=>{return e.displayName});
		if(!parray || parray.length==0){
			room.broadcast(user, "There are no players.", rank);
		}else if(args.length>0 & AuthManager.rankgeq(commandRank, config.rosterRank) && toId(args[0]) === "html" && room.id === "trivia"){
			let message = "/addhtmlbox <table style=\"background-color: #45cc51; margin: 2px 0;border: 2px solid #0d4916\" border=1><tr style=\"background-color: #209331\"><th>Players</th></tr>";
			message = message + "<tr><td><center>" + parray.join(", ") + "</center></td></tr>";
			message = message + "</table>"

			room.send(message);
		}else if(args.length > 0 && toId(args[0]) === "nohl"){
			room.broadcast(user, "The players in the game are " + prettyList(parray.map((p)=>{return "__"+p+"__"})) + ".", rank);
		}else{
			room.broadcast(user, "The players in the game are " + prettyList(parray.map((p)=>{return p})) + ".", rank);
		}
	},
	plshuffle: function(message, args, user, rank, room, commandRank, commandRoom){
		let plist = data.plist;
		if(!plist || plist.length==0){
			room.broadcast(user, "There are no players.", rank);
		}else if(args.length > 0 && toId(args[0]) === "nohl"){
			room.broadcast(user, prettyList(shuffle(plist).map(item=>{return "__"+item.displayName+"__"})), rank);
		}else{
			room.broadcast(user, prettyList(shuffle(plist).map(item=>{return item.displayName})), rank);
		}
	},
	plpick: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, config.rosterRank)){
			room.broadcast(user, "Your rank is not high enough to use the player list commands.", rank);
		}else{
			let plist = data.plist;
			if(!plist || plist.length==0){
				room.broadcast(user, "There are no players.", rank);
			}else if(args.length > 0 && toId(args[0]) === "nohl"){
				room.broadcast(user, "I randomly picked: __" + plist[Math.floor(Math.random()*plist.length)].displayName + "__", rank);
			}else{
				room.broadcast(user, "I randomly picked: " + plist[Math.floor(Math.random()*plist.length)].displayName, rank);
			}
		}
	},
	tl: "titanlist",
	titanlist: function(message, args, user, rank, room, commandRank, commandRoom){
		if(args.length>0 & AuthManager.rankgeq(commandRank, config.rosterRank)){
			let rarray = [];
			let aarray = [];
			for(let id in titanRegs){
				rarray.push(titanRegs[id]);
			}
			for(let id in titanAuth){
				aarray.push(titanAuth[id]);
			}
			if(toId(args[0]) === "html" && room.id === "trivia"){
				let message = "/addhtmlbox <table style=\"background-color: #45cc51; margin: 2px 0;border: 2px solid #0d4916\" border=1><tr style=\"background-color: #209331\"><th>Regs</th><th>Auth</th></tr>";
				for(let i=0;i<Math.max(rarray.length, aarray.length);i++){
					message = message + "<tr><td>" + (rarray[i] || "") + "</td><td>" + (aarray[i] || "") + "</td></tr>";
				}
				message = message + "</table>"

				room.send(message);
			}else{
				room.broadcast(user, "Regs: " + prettyList(rarray.map((p)=>{return "__"+p+"__"})) + ".", rank);
				room.broadcast(user, "Auth: " + prettyList(aarray.map((p)=>{return "__"+p+"__"})) + ".", rank);
			}
		}
	},
	clearpl: "plclear",
	plclear: function(message, args, user, rank, room, commandRank, commandRoom){
		if(AuthManager.rankgeq(commandRank, config.rosterRank) && !data.voices[user.id]){
			data.plist = [];
			data.scores = {};
			if(data.shouldVoice){
				for(let id in data.voices){
					commandRoom.send("/roomdeauth " + id);
				}
			}
			data.voices = {};
			room.broadcast(user, "Cleared the player list.", rank);
		}
	},
	titanclear: function(message, args, user, rank, room, commandRank, commandRoom){
		if(AuthManager.rankgeq(commandRank, config.rosterRank)){
			titanAuth = {};
			titanRegs = {};
			room.broadcast(user, "Cleared the auth and reg lists.", rank);
		}
	},
	addpoint: "addpoints",
	addpoints: function(message, args, user, rank, room, commandRank, commandRoom){
		let id = toId(args[0]);
		if(!AuthManager.rankgeq(commandRank, "+") || data.voices[user.id]){
			room.broadcast(user, "Your rank is not high enough to add points.", rank);
		}else if(!id || !args[1] || !/^-?\d+$/.test(args[1])){
			room.broadcast(user, "You must give a valid player and number of points.", rank);
		}else{
			let points = parseInt(args[1], 10);
			if(data.scores[id]){
				data.scores[id].score = data.scores[id].score + points;
			}else{
				data.scores[id] = {name: args[0], score: points};
			}
			room.broadcast(user, data.scores[id].name + "'s score is now " + data.scores[id].score + ".", rank);
		}
	},
	showmghpoints: function(message, args, user, rank, room, commandRank, commandRoom){
		let id = toId(args[0]);
		if(id){
			let entry = data.scores[id];
			if(entry){
				room.broadcast(user, entry.name + "'s score is " + entry.score + ".", rank);
			}else{
				room.broadcast(user, entry.name + " does not have a score.", rank);
			}
		}else{
			let scores = [];
			for(let p in data.scores){
				scores.push(data.scores[p]);
			}
			scores.sort((e1,e2)=>{return e1.score < e2.score});
			if(scores.length == 0){
				room.broadcast(user, "No one has any points.", rank);
			}else{
				room.broadcast(user, "The current scores are: " + scores.map(e=>{return "__" + e.name + "__ (" + e.score + ")"}).join(", "), rank);
			}
		}
	},
	clearpoints: function(message, args, user, rank, room, commandRank, commandRoom){
		if(AuthManager.rankgeq(commandRank, config.rosterRank) && !data.voices[user.id]){
			data.scores = {};
			room.broadcast(user, "Cleared the current scores.", rank);
    	}
	},
	reghost: function(message, args, user, rank, room, commandRank, commandRoom){
		let host = commandRoom.getUserData(toId(args[0]));
		if(!AuthManager.rankgeq(commandRank, "%")){
			room.broadcast(user, "Your rank is not high enough to appoint a reghost.", rank);
		}else if(!host){
			room.broadcast(user, "You must give a user in Trivia to appoint as a reghost.", rank);
		}else if(AuthManager.getTrueRoomRank(host, commandRoom) !== " "){
			room.broadcast(user, "That user already has a rank.", rank);
		}else if(data.hosts[host.id]){
			room.broadcast(user, "That user is already a reghost.", rank);
		}else if(Object.keys(data.hosts).length > 1){
			room.broadcast(user, "There cannot be more than two reghosts.", rank);
		}else if(!commandRoom){
			room.broadcast(user, "I'm not in Trivia currently.", rank);
		}else{
			data.hosts[host.id] = host;
			commandRoom.send("/roomvoice " + host.id);
			room.broadcast(user, "Successfully added the host.", rank);
		}
	},
	endhost: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, "%")){
			room.broadcast(user, "Your rank is not high enough to end a reghost.", rank);
		}else{
			for(let host in data.hosts){
				commandRoom.send("/roomdeauth " + data.hosts[host].id);
				data.hosts[host].rank = " ";
				data.hosts[host].trueRank = " ";
			}
			data.hosts = {};
			room.broadcast(user, "Successfully removed the hosts.", rank);
		}
	},
	modchat: function(message, args, user, rank, room, commandRank, commandRoom){
		let arg = toId(args[0]);
		if(!AuthManager.rankgeq(commandRank, "%")){
			room.broadcast(user, "Your rank is not high enough to turn on modchat.", rank);
		}else if(!commandRoom){
			room.broadcast(user, "I'm not in Trivia currently.", rank);
		}else{
			if(arg === "on"){
				if(data.shouldVoice){
					room.broadcast(user, "Modchat is already on.", rank);
				}else{
					data.shouldVoice = true;
					for(let id in data.voices){
						commandRoom.send("/roomvoice " + id);
					}
					commandRoom.send("/modchat +");
				}
			}else if(arg === "off"){
				if(!data.shouldVoice){
					room.broadcast(user, "Modchat is already off.", rank);
				}else{
					data.shouldVoice = false;
					for(let id in data.voices){
						commandRoom.send("/roomdeauth " + id);
						data.voices[id].rank = " ";
						data.voices[id].trueRank = " ";
					}
					commandRoom.send("/modchat ac");
				}
			}
		}
	},
	triviasignups: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, "+")){
			room.broadcast(user, "Your rank is not high enough to start an official game.", rank);
		}else if(!commandRoom){
			room.broadcast(user, "I'm not in Trivia currently.", rank);
		}else{
			commandRoom.send("/trivia new timer, all, long");
			commandRoom.send("**Triviasignups! Type ``/trivia join`` if you want to participate!** BP is now locked.");
			commandRoom.send("!rfaq official");
			if(tt && tt.getData().games[commandRoom.id]){
				let game = tt.getData().games[commandRoom.id];
				game.doBpLock(false);
			}
		}
	},
	triviastart: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, "+")){
			room.broadcast(user, "Your rank is not high enough to start an official game.", rank);
		}else if(!commandRoom){
			room.broadcast(user, "I'm not in Trivia currently.", rank);
		}else{
			commandRoom.send("/trivia start");
			commandRoom.send("**Triviastart, good luck! Remember to only answer using ``/ta`` or else you may be warned/muted!**");
		}
	},
	next: function(message, args, user, rank, room, commandRank, commandRoom){
		let timeDiff = (1457024400000-new Date().getTime())%14400000+14400000;
		let response = "The next official is (theoretically) in " + millisToTime(timeDiff) + ".";
		room.broadcast(user, response, rank, true);
	},
};

self.commands = commands;
exports.commands = commands;

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

let addPlayers = function(names, room){
	if(names.length==0) return "Player list not updated. You must give at least one player.";
	if(!data.plist) data.plist = [];
	let plist = data.plist;
	for(let i=0;i<names.length;i++){
		let user = room.getUserData(toId(names[i]));
		if(!user) continue;
		if(!data.voices[user.id] && user.trueRank === " "){
			data.voices[user.id] = user;
			// The following lines would make things more convenient, but for security reasons they should not be included.
			// Theoretically, voices would be able to voice people under certain circumstances if they were uncommented.
			// if(data.shouldVoice){
			// 	chat.js.say("trivia", "/roomvoice " + id);
			// }
		}
		for(let j=0;j<plist.length+1;j++){
			if(j == plist.length){
				plist.push({id: user.id, displayName: user.name});
				break;
			}else if(user.id == plist[j].id){
				break;
			}
		}
	}
	let n = plist.length;
	return "Player list updated. There " + (n==1?"is":"are") + " now " + n + " player" + (n==1?"":"s") + "."
}

let removePlayers = function(names){
	if(names.length==0) return "Player list not updated. You must give at least one player.";
	if(!data.plist) data.plist = [];
	let triviaRoom = RoomManager.getRoom("trivia");
	for(let i=0;i<names.length;i++){
		let userId = toId(names[i]);
		if(data.voices[userId]){
			if(data.shouldVoice && triviaRoom){
				triviaRoom.send("/roomdeauth " + userId);
				data.voices[userId].rank = " ";
			}
			delete data.voices[userId];
		}
		if(data.scores[userId]) delete data.scores[userId]
		data.plist = data.plist.filter(item=>{return item.id !== userId});
	}
	let n = data.plist.length;
	return "Player list updated. There " + (n==1?"is":"are") + " now " + n + " player" + (n==1?"":"s") + "."
}

let officialReminder = function(){
	let triviaRoom = RoomManager.getRoom(GOVERNING_ROOM);
	if(triviaRoom) triviaRoom.send("Time for the next official!");
	let timeDiff = (1457024400000-new Date().getTime())%14400000+14400000;
	if(timeDiff < 1000*60) timeDiff = 14400000;
	if(config.officialReminders) data.remindTimer = setTimeout(()=>{
		data.remindTimer = null;
		officialReminder();
	}, timeDiff);
	info("Set the reminder for " + timeDiff/1000/60 + " minutes");
}

// When TT games are rewritten to be objects, this no longer be needed
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

let defaultConfigs = {
	rosterRank: "+",
	officialReminders: 1
};

exports.defaultConfigs = defaultConfigs;

let configTypes = {
	rosterRank: "rank",
	officialReminders: "int"
};

exports.configTypes = configTypes;
