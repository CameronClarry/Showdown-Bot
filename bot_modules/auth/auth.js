let fs = getRequirement("fs");
let self = {js:{},data:{},requiredBy:[],hooks:{},config:{}};
let ranks = [" ", "+", "%", "@", "&", "#", "~"];
let chat = null;
let rooms = null;
info("AUTH STARTING");
exports.onLoad = function(module, loadData){
	self = module;
	self.js.refreshDependencies();
	if(loadData){
		self.data = {};
		self.data.authlist = {};
		authCommands.load();
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
					if(commands[command] && chat && chat.js){
						commands[command](m, chatArgs);
					}
				}
			}
		}
	};
};
exports.onUnload = function(){

};
exports.refreshDependencies = function(){
    chat = getModuleForDependency("chat", "auth");
    rooms = getModuleForDependency("rooms", "auth");
};
exports.onConnect = function(){

};

let commands = {
	auth: function(message, args){
		if(args.length>0){
			let command = args[0];
			if(authCommands[command]){
				authCommands[command](message, args);
			}
		}
	}
};

let authCommands = {
	set: function(message, args){
		if(args.length===4){
			let room = normalizeText(args[2]);
			let user = normalizeText(args[1]);
			let rank = args[3]==="" ? " " : args[3];
			let speakerGlobalRank = getGlobalRank(message.user);
			let userGlobalRank = getGlobalRank(user);
			if(room==="Global"){
				if(rankg(speakerGlobalRank, rank) && rankg(speakerGlobalRank, userGlobalRank)){
					if(!self.data.authlist[user]){
						self.data.authlist[user] = {displayName: args[1], ranks:{}};
					}
					if(rank === " "){
						delete self.data.authlist[user].ranks.Global;
						authCommands.checkEmpty(user);
					}else{
						self.data.authlist[user].ranks.Global = rank;
					}
					authCommands.save();
					info("Success");
					return;
				}
			}else{
				let userRoomRank = getRoomRank(user, room);
				let speakerRoomRank = getRoomRank(message.user);
				let speakerBeatsUser = rankgeq(speakerGlobalRank, userRoomRank) || rankg(speakerRoomRank, userRoomRank);
				let speakerBeatsRank = rankgeq(speakerGlobalRank, rank) || rankg(speakerRoomRank, rank);
				if(speakerBeatsUser&&speakerBeatsRank){
					if(!self.data.authlist[user]){
						self.data.authlist[user] = {displayName: args[1], ranks:{}};
					}
					if(rank === " "){
						delete self.data.authlist[user].ranks[room];
						authCommands.checkEmpty(user);
					}else{
						self.data.authlist[user].ranks[room] = rank;
					}
					authCommands.save();
					info("Success");
					return;
				}
			}
			info("Failure");
			return;
		}else if(args.length===3 && message.source==="chat"){
			let newArgs = [args[0], args[1], message.room, args[2]];
			authCommands.set(message, newArgs);
		}
	},
	checkEmpty: function(user){
		let normalUser = normalizeText(user);
		if(self.data.authlist[normalUser]){
			let numRanks = 0;
			for(let rank in self.data.authlist[normalUser].ranks){
				numRanks++;
			}
			if(numRanks === 0){
				delete self.data.authlist[normalUser];
			}
		}
	},
	check: function(message, args){
		let user = message.user;
		if(args.length > 1){
			user = args[1];
		}
		let result = "Error trying to check " + user + "'s rank.";
		if(!self.data.authlist[normalizeText(user)]){
			result = "There is no rank information for " + user + ".";
		}else{
			user = normalizeText(user);
			let entry = self.data.authlist[user];
			result = entry.displayName + "'s ranks are: ";
			let numRooms = 0;
			for(let room in entry.ranks){
				if(numRooms !== 0){
					result += ", ";
				}
				result += entry.ranks[room] + " in " + room;
				numRooms++;
			}
		}
		chat.js.reply(message, result);
	},
	save: function(message, args){
		let result = "Could not save the auth list.";
		let rank = "";
		if(message){
			rank = getGlobalRank(message.user);
			if(!rankgeq(rank,"#")){
				return;
			}
		}
		try{
			let filename = "bot_modules/auth/authlist.json";
			let authFile = fs.openSync(filename,"w");
			fs.writeSync(authFile,JSON.stringify(self.data.authlist, null, "\t"));
			fs.closeSync(authFile);
			result = "Successfully saved the auth file.";
		}catch(e){
			error(e.message);
		}
		if(message){
			chat.js.reply(message, result);
		}else{
			info(result);
		}
	},
	load: function(message, args){
		let result = "Could not load the auth list.";
		let rank = "";
		if(message){
			rank = getGlobalRank(message.user);
			if(!rankgeq(rank,"#")){
				return;
			}
		}
		try{
			let normalOwner = normalizeText(mainConfig.owner);
			let filename = "bot_modules/auth/authlist.json";
			if(fs.existsSync(filename)){
				self.data.authlist = JSON.parse(fs.readFileSync(filename, "utf8"));
				if(!self.data.authlist[normalOwner]||!self.data.authlist[normalOwner].rooms||self.data.authlist[normalOwner].rooms.Global!=="~"){
					self.data.authlist[normalOwner] = {
						displayName: mainConfig.owner,
						ranks: {
							Global: "~"
						}
					};
				}
				result = "Found and loaded the auth list.";
			}else{
				self.data.authlist = {};
				self.data.authlist[normalOwner] = {
					displayName: mainConfig.owner,
					ranks: {
						Global: "~"
					}
				};
				let authFile = fs.openSync(filename,"w");
				fs.writeSync(authFile,JSON.stringify(self.data.authlist, null, "\t"));
				fs.closeSync(filename);
				result = "Could not find the auth list file, made a new one.";
			}
		}catch(e){
			error(e.message);
			info(result);
		}
		if(message){
			chat.js.reply(message, result);
		}else{
			info(result);
		}
	},
	effRank: function(message, args){
		info(JSON.stringify(args));
		chat.js.reply(message, "Your effective rank in " + args[1] + " is '" + getEffectiveRoomRank(message, args[1]) + "'.");
	}
};

//returns true iff rank1 and rank2 are valid ranks, and rank1>=rank2
let rankgeq = function(rank1, rank2){
	let i1 = ranks.indexOf(rank1);
	let i2 = ranks.indexOf(rank2);
	return i1 !== -1 && i2 !== -1 && i1 >= i2;
};
exports.rankgeq = rankgeq;

//returns true iff rank1 and rank2 are valid ranks, and rank1>rank2
let rankg = function(rank1, rank2){
	let i1 = ranks.indexOf(rank1);
	let i2 = ranks.indexOf(rank2);
	return i1 !== -1 && i2 !== -1 && i1 > i2;
};
exports.rankg = rankg;

let getRank = function(abnormaluser, room){
	let user = normalizeText(abnormaluser);
	if(!self.data.authlist[user]||!self.data.authlist[user].ranks){
		return " ";
	}
	let roomRank = self.data.authlist[user].ranks[room];
	let globalRank = self.data.authlist[user].ranks.Global;
	if(roomRank&&(rankgeq(roomRank,globalRank)||!globalRank)){
		return roomRank;
	}else if(globalRank){
		return globalRank;
	}
	return " ";
};
exports.getRank = getRank;

let getRoomRank = function(abnormaluser, room){
	let user = normalizeText(abnormaluser);
	if(!self.data.authlist[user]||!self.data.authlist[user].ranks){
		return " ";
	}
	let roomRank = self.data.authlist[user].ranks[room];
	if(roomRank){
		return roomRank;
	}
	return " ";
};
exports.getRoomRank = getRoomRank;

let getGlobalRank = function(abnormaluser){
	let user = normalizeText(abnormaluser);
	if(!self.data.authlist[user]||!self.data.authlist[user].ranks){
		return " ";
	}
	let globalRank = self.data.authlist[user].ranks.Global;
	if(globalRank){
		return globalRank;
	}
	return " ";
};
exports.getGlobalRank = getGlobalRank;

let getEffectiveRoomRank = function(message, room){
	let username = message.user;
	let rank = getRank(username, room);
	if(rooms){
		let displayName = rooms.js.getDisplayName(username, room);
		if(displayName && rankg(displayName[0], rank)){
			rank = displayName[0];
		}
	}else if(message.source === "pm" || message.room === room){
		if(rankg(username[0], rank)){
			rank = username[0];
		}
	}
	return rank;
};
exports.getEffectiveRoomRank = getEffectiveRoomRank;
