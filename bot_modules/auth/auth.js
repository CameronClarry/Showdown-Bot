let fs = getRequirement("fs");
let self = {js:{},data:{},requiredBy:[],hooks:{},config:{}};
let ranks = [" ", "+", "%", "@", "*", "&", "#", "~"];
let chat = null;
let rooms = null;
info("AUTH STARTING");
exports.onLoad = function(module, loadData){
	self = module;
	self.js.refreshDependencies();
	if(loadData){
		self.data = {};
		self.data.authlist = {};
		loadAuth();
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
					if(commands[command]){
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
	},
	roomauth: function(message, args){
		if(args.length>1){
			info(args[0]);
			info(args[1]);
			tryReply(message,"The rank is '" + getRoomRank(args[0],args[1]) + "'");
		}
	}
};

let authCommands = {
	set: function(message, args){
		let room = toRoomId(args[3]) || message.room;
		let user = toId(args[1]);
		let response = "";
		let rank = args[2] || " ";
		if(!room){
			response = "You must specify a room.";
		}else if(!user){
			response = "You must specify a user.";
		}else{
			let setterGlobalRank = getGlobalRank(message.user);
			let setteeGlobalRank = getGlobalRank(user);
			let entry = self.data.authlist[user];
			if(!entry){
				self.data.authlist[user] = {displayName: args[1], ranks:{}};
				entry = self.data.authlist[user];
			}
			if(room === "global"){
				if(!rankg(setterGlobalRank, rank)){
					response = "You can only set someone to a rank lower than your own.";
				}else if(!rankg(setterGlobalRank, setteeGlobalRank)){
					response = "You can only set the ranks of users that are ranked below you.";
				}else{
					if(rank === " "){
						if(!entry.ranks.Global){
							response = entry.displayName + " does not have a global rank.";
						}else{
							delete entry.ranks.Global;
							authCommands.checkEmpty(user);
							saveAuth();
							response = "Removed " + entry.displayName + "'s global rank.";
						}
					}else{
						if(entry.ranks.Global === rank){
							response = entry.displayName + "'s global rank is already " + rank + ".";
						}else{
							entry.ranks.Global = rank;
							saveAuth();
							response = "Set " + entry.displayName + "'s global rank to " + rank + ".";
						}
					}
				}
			}else{
				let setteeRoomRank = getRoomRank(user, room);
				let setterRoomRank = getRoomRank(message.user);
				let setterBeatsSettee = rankgeq(setterGlobalRank, setteeRoomRank) || rankg(setterRoomRank, setteeRoomRank);
				let setterBeatsRank = rankgeq(setterGlobalRank, rank) || rankg(setterRoomRank, rank);
				if(!setterBeatsRank){
					response = "You can only set someone to a rank lower than your own.";
				}else if(!setterBeatsSettee){
					response = "You can only set the ranks of users that are ranked below you.";
				}else{
					if(rank === " "){
						if(!entry.ranks[room]){
							response = entry.displayName + " does not have a rank in " + room + ".";
						}else{
							delete entry.ranks[room];
							authCommands.checkEmpty(user);
							saveAuth();
							response = "Removed " + entry.displayName + "'s rank in " + room + ".";
						}
					}else{
						if(entry.ranks[room] === rank){
							response = entry.displayName + "'s rank in " + room + " is already " + rank + ".";
						}else{
							entry.ranks[room] = rank;
							saveAuth();
							response = "Set " + entry.displayName + "'s rank in " + room + " to " + rank + ".";
						}
					}
				}
			}
		}
		tryReply(message, response);
	},
	checkEmpty: function(user){
		let normalUser = toId(user);
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
		let response = "";
		let entry = self.data.authlist[toId(user)];
		if(!entry){
			response = "There is no rank information for " + user + ".";
		}else{
			let ranks = [];
			for(let room in entry.ranks){
				ranks.push(entry.ranks[room] + " in " + room);
			}
			response = ranks.length ? entry.displayName + "'s ranks are: " + ranks.join(", ") : "There is no rank information for " + user + ".";
		}
		tryReply(message, response);
	},
	save: function(message, args){
		let response = "filler";
		let rank = getGlobalRank(message.user);
		if(!rankgeq(rank,"#")){
			response = "You rank is not high enough.";
		}else{
			let result = saveAuth();
			response = result || "Successfully saved the auth file.";
		}
		tryReply(message, response);
	},
	load: function(message, args){
		let response = "stuff";
		let rank = getGlobalRank(message.user);
		if(!rankgeq(rank,"#")){
			response = "Your rank is not high enough.";
		}else{
			let result = loadAuth();
			response = result || "Successfully loaded the auth file.";
		}
		tryReply(message, response);
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
	let user = toId(abnormaluser);
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
	let user = toId(abnormaluser);
	let rank = " "
	if(self.data.authlist[user]&&self.data.authlist[user].ranks){
		let roomRank = self.data.authlist[user].ranks[room];
		if(rankg(roomRank, rank)){
			rank = roomRank;
		}
	}
	if(rooms && rooms.js){
		let displayName = rooms.js.getDisplayName(user, room);
		if(displayName && rankg(displayName[0], rank)){
			rank = displayName[0];
		}
	}
	return rank;
};
exports.getRoomRank = getRoomRank;

let getGlobalRank = function(abnormaluser){
	let user = toId(abnormaluser);
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
	if(rooms && rooms.js){
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

let saveAuth = function(){
	try{
		let filename = "data/authlist.json";
		let authFile = fs.openSync(filename,"w");
		fs.writeSync(authFile,JSON.stringify(self.data.authlist, null, "\t"));
		fs.closeSync(authFile);
		return;
	}catch(e){
		error(e.message);
		return e.message;
	}
};

let loadAuth = function(){
	try{
		let normalOwner = toId(mainConfig.owner);
		let filename = "data/authlist.json";
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
			return;
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
			fs.closeSync(authFile);
			return "Could not find the auth list file, made a new one.";
		}
	}catch(e){
		error(e.message);
		return e.message;
	}
};

let tryReply = function(message, text){
	if(chat && chat.js){
		chat.js.reply(message, text);
	}else{
		info("Tried to send this, but there was no chat: " + text);
	}
};
