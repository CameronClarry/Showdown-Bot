let fs = require("fs");

let commands = {
	join: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, this.config.joinRoomRank.value)) return;
		if(!args.length || !toRoomId(args[0])){
			room.broadcast(user, "You must specify a room to join.");
			return;
		}

		let roomId = toRoomId(args[0]);
		info("JOIN COMMAND");
		info(JSON.stringify(args));
		send(`|/join ${roomId}`);
		if(this.roomList.indexOf(roomId) === -1){
			this.roomList.push(roomId);
			this.saveRoomList();
		}
	},
	leave: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, this.config.joinRoomRank.value)) return;
		if(!args.length || !toRoomId(args[0])){
			room.broadcast(user, "You must specify a room to leave.");
			return;
		}

		let roomId = toRoomId(args[0]);
		send(`|/leave ${roomId}`);
		let index = this.roomList.indexOf(roomId);
		if(index !== -1){
			this.roomList.splice(index, 1);
			this.saveRoomList();
		}
	},
	check: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, this.config.joinRoomRank.value)) return;

		let roomId = toRoomId(args[0]);
		info(`Checking '${roomId}'.`);
		let r = RoomManager.getRoom(roomId);
		info(JSON.stringify(r,null,"\t"));
	}
};

class Rooms extends BaseModule{
	constructor(){
		super();
		this.room = Rooms.room;
		this.config = {
			joinRoomRank: new ConfigRank("#")
		};
		this.commands = commands;
	}

	onLoad(){
		this.loadRoomList();
	}

	onUnload(){
		this.leaveAllRooms();
	}

	onConnect(){
		this.joinAllRooms();
	}

	recover(oldModule){
		this.roomList = oldModule.roomList;
	}

	loadRoomList(){
			try{
				let path = "data/roomlist.json";
				if(fs.existsSync(path)){
					this.roomList = JSON.parse(fs.readFileSync(path, "utf8"));
					ok("Successfully loaded the room list.");
				}else{
					this.roomList = [];
					let roomFile = fs.openSync(path,"w");
					fs.writeSync(roomFile,JSON.stringify(this.roomList, null, "\t"));
					fs.closeSync(roomFile);
					error("No room list found, saved a new one.");
				}
			}catch(e){
				error(e.message);
				error("Could not load the room list.");
			}
	}

	saveRoomList(){
		try{
			let path = "data/roomlist.json";
			let roomFile = fs.openSync(path,"w");
			fs.writeSync(roomFile,JSON.stringify(this.roomList, null, "\t"));
			fs.closeSync(roomFile);
			ok("Saved the room list.");
		}catch(e){
			error(e.message);
			error("Could not save the room list.");
		}
	}

	joinAllRooms(){
		for(let i=0;i<this.roomList.length;i++){
			send(`|/join ${this.roomList[i]}`);
		}
	}

	leaveAllRooms(){
		for(let i=0;i<this.roomList.length;i++){
			send(`|/leave ${this.roomList[i]}`);
		}
	}
}

exports.Module = Rooms;
