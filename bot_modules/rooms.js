let fs = require("fs");
let self = {js:{},data:{},requiredBy:[],hooks:{},config:{}};
let data = {};
let config = defaultConfigs;
const GOVERNING_ROOM = "";
exports.GOVERNING_ROOM = GOVERNING_ROOM;

exports.onLoad = function(module, loadData, oldData){
	self = module;
	refreshDependencies();
	if(oldData) data = oldData;
	leaveAllRooms();
	if(loadData){
		data = {roomlist: []};
		loadRoomlist();
	}
	joinAllRooms();
};
exports.onUnload = function(){
	leaveAllRooms();
};
let refreshDependencies = function(){
};
exports.refreshDependencies = refreshDependencies;
exports.onConnect = function(){
	joinAllRooms();
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
	join: function(message, args, user, rank, room, commandRank, commandRoom){
		info("JOIN COMMAND");
		info(JSON.stringify(args));
		if(args.length>0){
			let roomId = toRoomId(args[0]);
			if(AuthManager.rankgeq(commandRank,"#")){
				send("|/join " + roomId);
				if(data.roomlist.indexOf(roomId) === -1){
					data.roomlist.add(roomId);
					saveRoomlist();
				}
			}
		}
	},
	leave: function(message, args, user, rank, room, commandRank, commandRoom){
		if(args.length>0){
			let roomId = toRoomId(args[0]);
			if(AuthManager.rankgeq(commandRank,"#")){
				send("|/leave " + roomId);
				if(data.roomlist.indexOf(roomId) !== -1){
					data.roomlist.remove(roomId);
					saveRoomlist();
				}
			}
		}
	},
	check: function(message, args, user, rank, room, commandRank, commandRoom){
		if(AuthManager.rankgeq(commandRank,"#")){
			let roomId = toRoomId(args[0]);
			info("Checking '" + roomId + "'.");
			let room = RoomManager.getRoom(roomId);
			info(JSON.stringify(room,null,"\t"));
		}
	}
};
exports.commands = commands;

let loadRoomlist = function(){
		try{
			let filename = "data/roomlist.json";
			if(fs.existsSync(filename)){
				data.roomlist = JSON.parse(fs.readFileSync(filename, "utf8"));
				ok("Successfully loaded the room list.");
			}else{
				data.roomlist = [];
				let roomFile = fs.openSync(filename,"w");
				fs.writeSync(roomFile,JSON.stringify(data.roomlist, null, "\t"));
				fs.closeSync(roomFile);
				error("No room list found, saved a new one.");
			}
		}catch(e){
			error(e.message);
			error("Could not load the room list.");
		}
};

let saveRoomlist = function(){
	try{
		let filename = "data/roomlist.json";
		let roomFile = fs.openSync(filename,"w");
		fs.writeSync(roomFile,JSON.stringify(data.roomlist, null, "\t"));
		fs.closeSync(roomFile);
		ok("Saved the room list.");
	}catch(e){
		error(e.message);
		error("Could not save the room list.");
	}
};

let joinAllRooms = function(){
	info("Joining all rooms");
	info(JSON.stringify(data.roomlist));
	for(let i=0;i<data.roomlist.length;i++){
		send("|/join " + data.roomlist[i]);
	}
};

let leaveAllRooms = function(){
	if(data&&data.roomlist){
		for(let i=0;i<data.roomlist.length;i++){
			send("|/leave " + data.roomlist[i]);
		}
	}
};

let defaultConfigs = {
	joinRoomRank: "#"
};

exports.defaultConfigs = defaultConfigs;

let configTypes = {
	joinRoomRank: "rank"
};

exports.configTypes = configTypes;
