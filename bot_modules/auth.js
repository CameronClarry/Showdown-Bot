let commands = {
	auth: function(message, args, user, rank, room, commandRank, commandRoom){
		if(args.length>0){
			let command = args[0];
			if(authCommands[command]){
				authCommands[command](message, args, user, rank, room, commandRank, commandRoom);
			}
		}
	}
};

let authCommands = {
	set: function(message, args, user, rank, room, commandRank, commandRoom){
		// get the desired room
		// get the user's rank in that room
		// get the target's internal rank in that room
		// if the user's rank is higher than the target's
		// and higher than the desired rank, set the target's rank
		// ~auth set, user, room, rank
		if(args.length < 4){
			room.broadcast(user, "You must give the user, the room, and the desired rank.");
			return;
		}

		let roomId = args[2] === 'Global' ? 'Global' : toRoomId(args[2]);
		let desiredRoom = RoomManager.getRoom(roomId);
		let targetId = toId(args[1]);
		desiredRoom = RoomManager.getRoom(desiredRoom);

		let userRank = AuthManager.getRank(user, desiredRoom);
		let targetRank = AuthManager.userAuth[targetId] ? AuthManager.userAuth[targetId][roomId] || ' ' : ' ';
		let desiredRank = args[3] || ' ';

		info(userRank);
		info(targetRank);
		info(desiredRank);

		if(!roomId){
			room.broadcast(user, "You must specify a room.");
		}else if(!user){
			room.broadcast(user, "You must specify a user.");
		}else if(!AuthManager.isRank(desiredRank)){
			room.broadcast(user, "You must give a valid rank.");
		}else if(!AuthManager.rankg(userRank, desiredRank)){
			room.broadcast(user, "You can only give out ranks lower than your own.");
		}else if(!AuthManager.rankg(userRank, targetRank)){
			room.broadcast(user, "You must have a higher rank than someone in order to change their rank.");
		}else{
			if(desiredRank === ' '){
				room.broadcast(user, deleteRank(targetId, roomId));
			}else{
				room.broadcast(user, setRank(targetId, roomId, desiredRank));
			}
		}
	},
	check: function(message, args, user, rank, room, commandRank, commandRoom){
		let target = args[1] || user.name;
		let targetId = toId(target);
		let entry = AuthManager.userAuth[targetId];
		if(!entry || Object.keys(entry).length === 0){
			room.broadcast(user, `There is no rank information for ${target}.`);
		}else{
			let ranks = [];
			for(let room in entry){
				ranks.push(`${entry[room]} in ${room}`);
			}
			room.broadcast(user, `${target}'s ranks are: ${ranks.join(', ')}.`);
		}
	},
	save: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!rankgeq(commandRank,"#")){
			room.broadcast(user, "Your rank is not high enough.");
		}else{
			AuthManager.saveAuth();
			room.broadcast(user, "Saved the auth file.");
		}
		tryReply(message, response);
	},
	load: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!rankgeq(commandRank,"#")){
			room.broadcast(user, "Your rank is not high enough.");
		}else{
			AuthManager.loadAuth();
			room.broadcast(user, "Loaded the auth file.");
		}
	}
};

let deleteRank = function(userId, roomId){
	let entry = AuthManager.userAuth[userId];
	if(entry && entry[roomId]){
		delete entry[roomId];
		cleanAuth(userId);
		AuthManager.saveAuth('data/authlist.json');
		return `Removed ${userId}'s rank in ${roomId}.`;
	}else{
		return `${userId} has no rank in ${roomId}.`;
	}
}

let setRank = function(userId, roomId, rank){
	let entry = AuthManager.userAuth[userId];
	if(!entry){
		entry = {};
		AuthManager.userAuth[userId] = entry;
	}

	entry[roomId] = rank;
	AuthManager.saveAuth('data/authlist.json');

	info(JSON.stringify(entry));

	return `Set ${userId}'s rank in ${roomId} to ${rank}.`;
}

// Remove whitespace ranks for the given userId
// If the userId has no ranks after, remove them from the list
let cleanAuth = function(userId){
	if(AuthManager.userAuth[userId] && Object.keys(AuthManager.userAuth[userId]).length === 0){
		delete AuthManager.userAuth[userId];
	}
}

class Auth extends BaseModule{
	constructor(){
		super();
		this.room = Auth.room;
		this.config = {};
		this.commands = commands;
	}
}

exports.Module = Auth;
