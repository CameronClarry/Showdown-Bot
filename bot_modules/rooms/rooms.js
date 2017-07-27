let fs = require("fs");
let self = {js:{},data:{},requiredBy:[],hooks:{},config:{}};
let auth = null;
let formatregex = /([_~*`^])\1(.+)\1\1/g;
exports.onLoad = function(module, loadData){
	self = module;
	self.js.refreshDependencies();
	leaveAllRooms();
	if(loadData){
		self.data = {rooms: {}, roomlist: []};
		loadRoomlist();
	}
	joinAllRooms();
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
						commands[command](m, chatArgs);
					}
				}else if(/\/invite\s/.test(text)){
					let roomName = toRoomId(text.split(" ")[1]);
					let userRank = auth.js.getEffectiveRoomRank(m, roomName);
					if(auth.js.rankgeq(userRank,"#")){
						send("|/join " + roomName);
					}
				}
			}
		},
	};
	self.messagehooks = {
		roomActionHook: function(room, args){
			if(args.length>1){
				let command = args[1];
				let func = roomActions[command];
				if(typeof func === "string"){
					func = roomActions[func];
				}
				if(typeof func === "function"){
					func(room, args);
				}
			}
		}
	};
};
exports.onUnload = function(){
	leaveAllRooms();
};
exports.refreshDependencies = function(){
	auth = getModuleForDependency("auth", "modulemanager");
};
exports.onConnect = function(){
	joinAllRooms();
};

let commands = {
	join: function(message, args){
		if(args.length>0){
			let roomName = toRoomId(args[0]);
			let userRank = auth.js.getEffectiveRoomRank(message, roomName);
			if(auth.js.rankgeq(userRank,"#")){
				send("|/join " + roomName);
			}
		}
	},
	leave: function(message, args){
		if(args.length>0){
			let roomName = toRoomId(args[0]);
			let userRank = auth.js.getEffectiveRoomRank(message, roomName);
			if(auth.js.rankgeq(userRank,"#")){
				send("|/leave " + roomName);
			}
		}
	}
};

let roomActions = {
	J: "join",
	j: "join",
	join: function(room, args){
		let id = toId(args[2]);
		let rooms = self.data.rooms;
		if(rooms[room]){
			rooms[room].users[id] = {displayName: replaceAll(args[2].trim(),formatregex)};
		}
	},
	L: "leave",
	l: "leave",
	leave: function(room, args){
		let id = toId(args[2]);
		let rooms = self.data.rooms;
		if(rooms[room]){
			delete rooms[room].users[id];
		}
	},
	N: "name",
	n: "name",
	name: function(room, args){
		let newName = args[2];
		let oldName = args[3];
		let rooms = self.data.rooms;
		if(rooms[room]){
			delete rooms[room].users[toId(oldName)];
			rooms[room].users[toId(newName)] = {displayName: replaceAll(newName.trim(),formatregex)};
		}
	},
	deinit: function(room, args){
		if(self.data.roomlist.indexOf(room) !== -1){
			self.data.roomlist.remove(room);
			saveRoomlist();
		}
		delete self.data.rooms[room];
	},
	init: function(room, args){
		self.data.rooms[room] = {users: {}};
		if(self.data.roomlist.indexOf(room) === -1){
			self.data.roomlist.add(room);
			saveRoomlist();
		}
	},
	noinit: function(room,args){
		if(self.data.roomlist.indexOf(room) !== -1){
			self.data.roomlist.remove(room);
			saveRoomlist();
			info("Could not join " + room + ", it has been removed from the autojoin list.");
		}else{
			error("Tried to join " + room + " and failed but couldn't find it in the roomlist, something may be wrong.");
		}
	},
	users: function(room, args){
		if(self.data.rooms[room]){
			let userlist = args[2].split(",");
			for(var i=1;i<userlist.length;i++){
				self.data.rooms[room].users[toId(userlist[i])] = {displayName: replaceAll(userlist[i].trim(),formatregex)};
			}
		}
	}
}

let loadRoomlist = function(){
		try{
			let filename = "data/roomlist.json";
			if(fs.existsSync(filename)){
				self.data.roomlist = JSON.parse(fs.readFileSync(filename, "utf8"));
				ok("Successfully loaded the room list.");
			}else{
				self.data.roomlist = [];
				let roomFile = fs.openSync(filename,"w");
				fs.writeSync(roomFile,JSON.stringify(self.data.roomlist, null, "\t"));
				fs.closeSync(roomFile);
				error("No room list found, saved a new one.")
			}
		}catch(e){
			error(e.message);
			error("Could not load the room list.")
		}
};

let saveRoomlist = function(){
	try{
		let filename = "data/roomlist.json";
		let roomFile = fs.openSync(filename,"w");
		fs.writeSync(roomFile,JSON.stringify(self.data.roomlist, null, "\t"));
		fs.closeSync(roomFile);
		ok("Saved the room list.");
	}catch(e){
		error(e.message);
		error("Could not save the room list.");
	}
};

let joinAllRooms = function(){
	for(let i=0;i<self.data.roomlist.length;i++){
		send("|/join " + self.data.roomlist[i]);
	}
};

let leaveAllRooms = function(){
	if(self.data&&self.data.roomlist){
		for(let i=0;i<self.data.roomlist.length;i++){
			send("|/leave " + self.data.roomlist[i]);
		}
	}
};
let isInRoom = function(user, room){
	let rooms = self.data.rooms;
	if(rooms[room] && rooms[room].users[toId(user)]){
		return true;
	}
	return false;
};
exports.isInRoom = isInRoom;

let getDisplayName = function(user, room){
	let id = toId(user);
	let rooms = self.data.rooms;
	if(rooms[room] && rooms[room].users[id]){
		return rooms[room].users[id].displayName;
	}
	return null;
}
exports.getDisplayName = getDisplayName;

let replaceAll = function(text, reg){
	while(reg.test(text)){
		text = text.replace(reg, "$2");
	}
	return text;
}

let defaultConfigs = {
	joinRoomRank: "#"
};

exports.defaultConfigs = defaultConfigs;

let configTypes = {
	joinRoomRank: "rank"
};

exports.configTypes = configTypes;
