const axios = require('axios');

exports.RoomManager = class{
	constructor(){
		this.rooms = {};
		this.queryAuth();
	}

	getUser(id, roomId){
		return this.rooms[roomId] && this.rooms[roomId].getUserData(id);
	}

	getRoom(roomId){
		return this.rooms[roomId];
	}

	initRoom(name){
		let room = new Room(name)
		this.rooms[room.id] = room;
		return room;
	}

	deinitRoom(name){
		let id = toRoomId(name);
		delete this.rooms[id];
	}

	// Processes popup messages to check for an auth list.
	handlePopup(text){
		let lines = text.split('||||');

		let match = lines[0].match(/^(.*) room auth:/);
		if(!match || !match.length) return;

		let roomId = toId(match[1]);

		if(!this.rooms[roomId]) return;

		let ranks = {};
		for(let i=0;i<lines.length;i++){
			let parts = lines[i].split('||');
			let match = parts[0].match(/\((.)\):/);
			if(parts.length < 2 || !match || !match.length) continue;

			let rank = match[1];
			let names = parts[1].split(',').map((e)=>{return toId(e)});
			ranks[rank] = names;
		}

		this.rooms[roomId].processAuth(ranks);
	}

	// Request a list of roomauth for all rooms that have at least one user
	// If a room has at least one user, it should be a legitimate room
	queryAuth(){
		for(let roomId in this.rooms){
			if(this.rooms[roomId].numUsers > 0){
				send(`|/roomauth ${roomId}`);
			}
		}

		setTimeout(()=>{this.queryAuth()}, 30*60*1000);
	}
}

//name, id, list of players
class Room{
	constructor(name, broadcastRank="+"){
		this.name = name;
		this.id = toRoomId(name);
		this.users = {};
		this.numUsers = 0;
		this.auth = {};
		this.broadcastRank = broadcastRank;
		this.lastCull = Date.now();
		this.firstGarbage = {};
		this.secondGarbage = {};
		this.doStafflessWarning = bot.config.noStaffRooms.value.indexOf(this.id) > -1;
		this.stafflessTimer = null;
		this.isStaffless = false;
	}
	
	userJoin(name, id, status, rank){
		// info("JOIN: " + name + ", " + id + ", " + status + ", " + rank);
		if(!this.users[id]){
			this.numUsers++;
		}
		let oldUser = this.firstGarbage[id] || this.secondGarbage[id];
		// info(JSON.stringify(oldUser));
		if(oldUser){
			this.users[id] = oldUser;
			//This will detect rank changes from when the user was not in the room
			this.users[id].updateData(name, rank, status);
			delete this.firstGarbage[id];
			delete this.secondGarbage[id];
		}else{
			this.users[id] = new User(name, rank, status);
		}

		if(this.isStaffless && AuthManager.rankg(this.users[id].trueRank, '+') && this.checkAuthCount() > 0){
			this.isStaffless = false;
			if(this.stafflessTimer){
				clearTimeout(this.stafflessTimer);
				this.stafflessTimer = null;
			}else{
				// Let the server know everything is okay
				this.sendNoAuthWarning(`${this.users[id].name} has joined the room.`);
			}
		}

		return this.users[id];
	}
	
	// This will ensure that the room's user list matches the new userArray, but will retain any User instances that have the same id.
	// This is done so that leaving and rejoining will preserve all the user objects.
	// A call to refresh the auth list is also made
	processUsers(userArray){
		let newUsers = {};
		for(let i=0;i<userArray.length;i++){
			let parts = userArray[i].substr(1).split("@");
			let rank = userArray[i][0];
			let name = parts[0];
			let id = toId(name);
			let status = parts[1];
			let oldUser = this.getUserData(id) || (this.firstGarbage[id] || this.secondGarbage[id]);
			newUsers[id] = oldUser ? oldUser.updateData(name, rank, status) : new User(name, rank, status);
		}
		this.users = newUsers;
		this.numUsers = userArray.length;

		send(`|/roomauth ${this.id}`);
	}

	processAuth(authData){
		this.auth = {};
		for(let rank in authData){
			for(let userId of authData[rank]){
				this.auth[userId] = rank;
			}
		}
	}

	userLeave(id){
		// info("LEAVE: " + id);
		let user;
		if(this.users[id]){
			user = this.users[id];
			this.firstGarbage[id] = this.users[id];
			delete this.users[id];
			this.numUsers--;

			if(this.doStafflessWarning && bot.config.discordStaffWebhook.value && AuthManager.rankg(user.trueRank, '+') && this.checkAuthCount() === 0){
				this.startNoAuthTimer();
			}
		}else{
			error("User left, but they were not known to be in the room");
		}
		return user;
		if(Date.now()-this.lastCull > 60*60*1000) this.cull();
	}

	//Updates a user when they /nick
	userNameChange(name, id, status, rank, prevId){
		// info("NAME: " + name + ", " + id + ", " + status + ", " + rank + ", " + prevId);
		// info(JSON.stringify(this.getUserData(prevId)));
		let user = this.getUserData(prevId);
		user.updateData(name, rank, status);
		if(id !== prevId){
			this.users[id] = user;
			delete this.users[prevId];
		}else{
			// Their rank may have changed, so let's update it
			if(this.auth[id] && rank === ' '){
				delete this.auth[id];
			}else if(rank !== ' '){
				this.auth[id] = rank;
			}
		}
		// info(JSON.stringify(this.getUserData(id)));
		return this.users[id];
	}

	getUserData(id){
		return this.users[id];
    }
    
    send(message){
        send(`${this.id}|${message}`);
    }

    //if toUser is at least the broadcast rank for toRoom, send the message to the room. Otherwise, send the message to the user.
    //will use the given rank if available, otherwise use the user's rank
    //toUser must be a user object from this room for the command to work as expected
    broadcast(toUser, text, rank, suppressPM){
        if(AuthManager.rankgeq(rank || toUser.rank, this.broadcastRank) && this.id){
            this.send(text);
        }else if(!suppressPM || !this.id){
            toUser.send(text);
        }else{
            toUser.send("Please only use that command through PMs.");
        }
    }
    
    cull(){
        this.lastCull = Date.now();
        for(let id in this.secondGarbage){
            delete this.secondGarbage[id];
        }
        this.secondGarbage = this.firstGarbage;
        this.firstGarbage = {};
    }

	checkAuthCount(){
		let authCount = 0;
		for(let id in this.users){
			if(AuthManager.rankg(this.users[id].trueRank, '+') && this.users[id].trueRank !== '*') authCount++;
		}
		return authCount;
	}

	startNoAuthTimer(){
		if(this.stafflessTimer){
			clearTimeout(this.stafflessTimer);
			this.stafflessTimer = null;
		}
		this.isStaffless = true;
		this.stafflessTimer = setTimeout(()=>{
			this.sendNoAuthWarning();
			this.stafflessTimer = null;
		}, 60*1000);
	}

	sendNoAuthWarning(message){
		axios.post(bot.config.discordStaffWebhook.value, {
			content: message || `The last staff member just left ${this.name}. <@&911610998799085608>`
		}).then(res => {
			
		}).catch(error => {
			error("Post to Discord webhook failed");
		});
	}
}

// name, id, rank, status, isAway
class User{
	constructor(name, rank, status){
		this.name = name;
		this.id = toId(name);
		this.rank = rank;
		this.trueRank = rank;
		this.status = status;
		this.isAway = status && status[0] === "!";
	}

	updateData(name=this.name,rank=this.rank,status=this.status){
		// If someone's true rank changes but their id doesn't, update the rank
		// If someone's name is changed to locked or muted, we should always update the rank
		if(this.trueRank !== rank && this.id === toId(name)){
			this.rank = rank;
		}else{
			this.rank = rank === "!" || rank === "‽" ? rank : AuthManager.getTopRank([rank, this.rank]);
		}
		this.name = name;
		this.id = toId(name);
		this.trueRank = rank;
		this.status = status;
		this.isAway = status && status[0] === "!";
		return this;
	}

    send(message){
        send(`|/pm ${this.id},${message}`);
    }
}
