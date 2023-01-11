let commands = {
	tar: "titanaddregs",
	titanaddreg: "titanaddregs",
	titanaddregs: function(message, args, user, rank, room, commandRank, commandRoom){
		if(args.length > 0 & AuthManager.rankgeq(commandRank, this.config.rosterRank.value)){
			let added = 0;
			for(let i=0;i<args.length;i++){
				let id = toId(args[i]);
				if(!(id in this.titanRegs) && !(id in this.titanAuth)){
					this.titanRegs[id] = args[i];
					added++;
				}
			}
			room.broadcast(user, `Added ${added} player(s) to the titanomachy regs.`, rank);
		}
	},
	taa: "titanaddauth",
	titanaddauth: function(message, args, user, rank, room, commandRank, commandRoom){
		if(args.length > 0 & AuthManager.rankgeq(commandRank, this.config.rosterRank.value)){
			let added = 0;
			for(let i=0;i<args.length;i++){
				let id = toId(args[i]);
				if(!(id in this.titanAuth) && !(id in this.titanRegs)){
					this.titanAuth[id] = args[i];
					added++;
				}
			}
			room.broadcast(user, `Added ${added} player(s) to the titanomachy auth.`, rank);
		}
	},
	tr: "titanremove",
	titanremove: function(message, args, user, rank, room, commandRank, commandRoom){
		if(args.length > 0 & AuthManager.rankgeq(commandRank, this.config.rosterRank.value)){
			let removed = 0;
			for(let i=0;i<args.length;i++){
				let id = toId(args[i]);
				if(id in this.titanRegs){
					delete this.titanRegs[id];
					removed++;
				}
				if(id in this.titanAuth){
					delete this.titanAuth[id];
					removed++;
				}
			}
			room.broadcast(user, `Removed ${removed} player(s) from the titanomachy roster.`, rank);
		}
	},
	tl: "titanlist",
	titanlist: function(message, args, user, rank, room, commandRank, commandRoom){
		if(AuthManager.rankgeq(commandRank, this.config.rosterRank.value)){
			let rarray = [];
			let aarray = [];
			for(let id in this.titanRegs){
				rarray.push(this.titanRegs[id]);
			}
			for(let id in this.titanAuth){
				aarray.push(this.titanAuth[id]);
			}
			if(toId(args[0]) === 'html' && room.id === 'trivia'){
				let message = `/addhtmlbox <table style="color: black; background-color: #45cc51; margin: 2px 0;border: 2px solid #0d4916" border=1><tr style="background-color: #209331"><th>Regs</th><th>Auth</th></tr>`;
				for(let i=0;i<Math.max(rarray.length, aarray.length);i++){
					message = message + `<tr><td>${rarray[i] || ""}</td><td>${aarray[i] || ""}</td></tr>`;
				}
				message = message + "</table>"

				room.send(message);
			}else{
				room.broadcast(user, `Regs: ${prettyList(rarray.map((p)=>{return `__${p}__`}))}.`, rank);
				room.broadcast(user, `Auth: ${prettyList(aarray.map((p)=>{return `__${p}__`}))}.`, rank);
			}
		}
	},
	tpr: "titanpickreg",
	titanpickreg: function(message, args, user, rank, room, commandRank, commandRoom){
		let plist = [];
		for(let id in this.titanRegs){
			plist.push(this.titanRegs[id]);
		}
		if(!plist || plist.length==0){
			room.broadcast(user, "There are no regs.", rank);
		}else if(args.length > 0 && toId(args[0]) === 'nohl'){
			room.broadcast(user, `I randomly picked: __${plist[Math.floor(Math.random()*plist.length)]}__`, rank);
		}else{
			room.broadcast(user, `I randomly picked: ${plist[Math.floor(Math.random()*plist.length)]}`, rank);
		}
	},
	tpa: "titanpickauth",
	titanpickauth: function(message, args, user, rank, room, commandRank, commandRoom){
		let plist = [];
		for(let id in this.titanAuth){
			plist.push(this.titanAuth[id]);
		}
		if(!plist || plist.length==0){
			room.broadcast(user, "There are no auth.", rank);
		}else if(args.length > 0 && toId(args[0]) === 'nohl'){
			room.broadcast(user, `I randomly picked: __${plist[Math.floor(Math.random()*plist.length)]}__`, rank);
		}else{
			room.broadcast(user, `I randomly picked: ${plist[Math.floor(Math.random()*plist.length)]}`, rank);
		}
	},
	titanclear: function(message, args, user, rank, room, commandRank, commandRoom){
		if(AuthManager.rankgeq(commandRank, this.config.rosterRank.value)){
			this.titanAuth = {};
			this.titanRegs = {};
			room.broadcast(user, "Cleared the auth and reg lists.", rank);
		}
	},
	fish: "triviasignups",
	tsu: "triviasignups",
	triviasignups: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, '+')){
			room.broadcast(user, "Your rank is not high enough to start an official game.", rank);
		}else if(!commandRoom){
			room.broadcast(user, "I'm not in Trivia currently.", rank);
		}else{
			commandRoom.send("/trivia new timer, all, long");
			commandRoom.send("**Triviasignups! Type ``/trivia join`` if you want to participate!** BP is now locked.");
			commandRoom.send("!rfaq official");
			if(this.tt && this.tt.games[commandRoom.id]){
				let game = this.tt.games[commandRoom.id];
				game.doBpLock(false);
			}
		}
	},
	starttrivia: "triviastart",
	tst: "triviastart",
	triviastart: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, '+')){
			room.broadcast(user, "Your rank is not high enough to start an official game.", rank);
		}else if(!commandRoom){
			room.broadcast(user, "I'm not in Trivia currently.", rank);
		}else{
			send("trivia|/trivia");
			this.shouldStart = true;
			setTimeout(()=>{this.shouldStart = false;}, 10000);
		}
	},
	nextofficial: "next",
	next: function(message, args, user, rank, room, commandRank, commandRoom){
		let timeDiff = getOfficialTime();
		let response = `The next official is (theoretically) in ${millisToTime(timeDiff)}.`;
		room.broadcast(user, response, rank, true);
	},
	nextcycle: function(message, args, user, rank, room, commandRank, commandRoom){
		let timeDiff = getResetTime();
		let response = `This cycle will end in ${millisToTime(timeDiff)}.`;
		room.broadcast(user, response, rank, true);
	}
};

let millisToTime = function(millis){
	let seconds = millis/1000;
	let days = Math.floor(seconds/86400);
	let hours = Math.floor((seconds%86400)/3600);
	let minutes = Math.floor((seconds%3600)/60);
	let response;
	if(days>0){
		response = `${days} day${days === 1 ? "" : "s"}, ${hours} hour${hours === 1 ? "" : "s"}, and ${minutes} minute${minutes === 1 ? "" : "s"}`;
	}else if(hours>0){
		response = `${hours} hour${hours === 1 ? "" : "s"} and ${minutes} minute${minutes === 1 ? "" : "s"}`;
	}else{
		response = `${minutes} minute${minutes === 1 ? "" : "s"}`;
	}
	return response;
};

// Gets the miliseconds to the next official
let getOfficialTime = function(){
	return (1457024400000-new Date().getTime())%14400000+14400000;
}

// Gets the miliseconds to the next cycle reset
let getResetTime = function(now=new Date()){
	let target;
	let dayOfMonth = now.getDate();
	if(dayOfMonth <= 15){
		// First cycle of the month
		target = new Date(now.getFullYear(), now.getMonth(), 16)
	}else{
		// Second cycle of the month
		target = new Date(now.getFullYear(), now.getMonth()+1, 1)
	}
	let timeDiff = target.getTime()-now.getTime();
	if(timeDiff < 60*1000){
		return getResetTime(new Date(now.getTime()+60*1000));
	}else{
		return timeDiff
	}
}


class MinigameHelper extends BaseModule{
	constructor(){
		super();
		this.room = MinigameHelper.room;
		this.config = {
			rosterRank: new ConfigRank('+'),
			officialReminders: new ConfigBoolean(true)
		};
		this.commands = commands;
		this.chathooks = {};
		this.messagehooks = {a: this.onMessage};
		this.dependencies = ['tt'];
	}

	onLoad(){
		this.titanRegs = {};
		this.titanAuth = {};

		if(!this.remindTimer && this.config.officialReminders.value){
			let timeDiff = getOfficialTime()
			this.remindTimer = setTimeout(()=>{
				this.remindTimer = null;
				this.officialReminder();
			}, timeDiff);
			info("Set the reminder for " + timeDiff/1000/60 + " minutes");
		}
		if(!this.cycleRemindTimer && this.config.officialReminders.value){
			let timeDiff = getResetTime()
			this.cycleRemindTimer = setTimeout(()=>{
				this.remindTimer = null;
				this.cycleReminder();
			}, timeDiff);
			info("Set the cycle reminder for " + timeDiff/1000/60 + " minutes");
		}
	}

	onUnload(){
		if(this.remindTimer){
			clearTimeout(this.remindTimer);
			this.remindTimer = null;
		}
		if(this.cycleRemindTimer){
			clearTimeout(this.cycleRemindTimer);
			this.cycleRemindTimer = null;
		}
	}

	recover(oldModule){
		this.remindTimer = oldModule.remindTimer;
		this.cycleRemindTimer = oldModule.cycleRemindTimer;
		this.titanRegs = oldModule.titanRegs;
		this.titanAuth = oldModule.titanAuth;
		this.joinTimer = oldModule.joinTimer;
		this.shouldStart = oldModule.shouldStart;
	}

	onMessage(room, args){
		// If there are players:
		// |c|~|/raw <div class="infobox">There is a trivia game in progress, and it is in its signups phase.<br />Mode: Timer | Category: All | Score cap: 50<br />Players: Struchni (0)</div>
		// |c|~|/raw <div class="infobox">There is a trivia game in progress, and it is in its signups phase.<br />Mode: Timer | Category: All | Score cap: 50<br />Current score:  | Correct Answers: <br />Players: Struchni (0), Codex Necro (0)</div>
		if(this.shouldStart && room.id === 'trivia' && args.length > 2 && args[1] == 'c'){
			if(args[3].match(/in its signups phase/)){
				this.startOfficial(room);
			}
		}
	}

	officialReminder(){
		let triviaRoom = RoomManager.getRoom(this.room);
		if(triviaRoom) triviaRoom.send("Time for the next official!");
		let timeDiff = getOfficialTime();
		if(timeDiff < 1000*60) timeDiff = 14400000;
		if(this.config.officialReminders.value) this.remindTimer = setTimeout(()=>{
			this.remindTimer = null;
			this.officialReminder();
		}, timeDiff);
		info("Set the reminder for " + timeDiff/1000/60 + " minutes");
	}

	cycleReminder(){
		let triviaRoom = RoomManager.getRoom(this.room);
		if(triviaRoom) triviaRoom.send("Time for the next Trivia Tracker cycle!");
		let timeDiff = getResetTime();
		if(this.config.officialReminders.value) this.cycleRemindTimer = setTimeout(()=>{
			this.cycleRemindTimer = null;
			this.cycleReminder();
		}, timeDiff);
		info("Set the cycle reminder for " + timeDiff/1000/60 + " minutes");
	}

	startOfficial(room){
		room.send("/trivia start");
		room.send("**Triviastart, good luck! Remember to only answer using ``/ta`` or else you may be warned/muted!**");
		this.shouldStart = false;
	}
}
MinigameHelper.room = 'trivia';

exports.Module = MinigameHelper;
