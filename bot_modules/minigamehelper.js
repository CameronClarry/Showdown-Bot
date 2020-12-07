let commands = {
	plmax: function(message, args, user, rank, room, commandRank, commandRoom){
		let max = args[0] && /^\d+$/.test(args[0]) ? parseInt(args[0]) : 0;
		if(!room){
			room.broadcast(user, "You cannot use this command through PM.", rank);
		}else if(!AuthManager.rankgeq(commandRank, this.config.rosterRank.value) || this.voices[user.id]){
			room.broadcast(user, "Your rank is not high enough to use the player list commands.", rank);
		}else if(room.id !== "trivia"){
			room.broadcast(user, "This command can only be used in Trivia.", rank);
		}else{
			this.maxplayers = max;
			if(max === 0){
				room.send("Autojoin has been turned off.");
			}else{
				room.send("**Autojoin is now on! Type ``/me in`` to join!**");
			}
		}
	},
	pladd: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, this.config.rosterRank.value) || this.voices[user.id]){
			room.broadcast(user, "Your rank is not high enough to use the player list commands.", rank);
		}else{
			let response = this.addPlayers(args, commandRoom);
			room.broadcast(user, response, rank);
		}
	},
	plremove: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, this.config.rosterRank.value) || this.voices[user.id]){
			room.broadcast(user, "Your rank is not high enough to use the player list commands.", rank);
		}else{
			let response = this.removePlayers(args);
			room.broadcast(user, response, rank);
		}
	},
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
	pl: "pllist",
	pllist: function(message, args, user, rank, room, commandRank, commandRoom){
    	let parray = this.plist.map(e=>{return e.displayName});
		if(!parray || parray.length==0){
			room.broadcast(user, "There are no players.", rank);
		}else if(args.length>0 & AuthManager.rankgeq(commandRank, this.config.rosterRank.value) && toId(args[0]) === 'html' && room.id === 'trivia'){
			let message = `/addhtmlbox <table style="background-color: #45cc51; margin: 2px 0;border: 2px solid #0d4916" border=1><tr style="background-color: #209331"><th>Players</th></tr>`;
			message = message + `<tr><td><center>${parray.join(', ')}</center></td></tr></table>`;

			room.send(message);
		}else if(args.length > 0 && toId(args[0]) === 'nohl'){
			room.broadcast(user, `The players in the game are ${prettyList(parray.map((p)=>{return `__${p}__`}))}.`, rank);
		}else{
			room.broadcast(user, `The players in the game are ${prettyList(parray.map((p)=>{return p}))}.`, rank);
		}
	},
	plshuffle: function(message, args, user, rank, room, commandRank, commandRoom){
		let plist = this.plist;
		if(!plist || plist.length==0){
			room.broadcast(user, "There are no players.", rank);
		}else if(args.length > 0 && toId(args[0]) === 'nohl'){
			room.broadcast(user, prettyList(shuffle(plist).map(item=>{return `__${item.displayName}__`})), rank);
		}else{
			room.broadcast(user, prettyList(shuffle(plist).map(item=>{return item.displayName})), rank);
		}
	},
	plpick: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, this.config.rosterRank.value)){
			room.broadcast(user, "Your rank is not high enough to use the player list commands.", rank);
		}else{
			let plist = this.plist;
			if(!plist || plist.length==0){
				room.broadcast(user, "There are no players.", rank);
			}else if(args.length > 0 && toId(args[0]) === 'nohl'){
				room.broadcast(user, `I randomly picked: __${plist[Math.floor(Math.random()*plist.length)].displayName}__`, rank);
			}else{
				room.broadcast(user, `I randomly picked: ${plist[Math.floor(Math.random()*plist.length)].displayName}`, rank);
			}
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
				let message = `/addhtmlbox <table style="background-color: #45cc51; margin: 2px 0;border: 2px solid #0d4916" border=1><tr style="background-color: #209331"><th>Regs</th><th>Auth</th></tr>`;
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
	clearpl: "plclear",
	plclear: function(message, args, user, rank, room, commandRank, commandRoom){
		if(AuthManager.rankgeq(commandRank, this.config.rosterRank.value) && !this.voices[user.id]){
			this.plist = [];
			this.scores = {};
			if(this.shouldVoice){
				for(let id in this.voices){
					commandRoom.send(`/roomdeauth ${id}`);
				}
			}
			this.voices = {};
			room.broadcast(user, "Cleared the player list.", rank);
		}
	},
	titanclear: function(message, args, user, rank, room, commandRank, commandRoom){
		if(AuthManager.rankgeq(commandRank, this.config.rosterRank.value)){
			this.titanAuth = {};
			this.titanRegs = {};
			room.broadcast(user, "Cleared the auth and reg lists.", rank);
		}
	},
	addpoint: "addpoints",
	addpoints: function(message, args, user, rank, room, commandRank, commandRoom){
		let id = toId(args[0]);
		if(!AuthManager.rankgeq(commandRank, '+') || this.voices[user.id]){
			room.broadcast(user, "Your rank is not high enough to add points.", rank);
		}else if(!id || !args[1] || !/^-?\d+$/.test(args[1])){
			room.broadcast(user, "You must give a valid player and number of points.", rank);
		}else{
			let points = parseInt(args[1], 10);
			if(this.scores[id]){
				this.scores[id].score = this.scores[id].score + points;
			}else{
				this.scores[id] = {name: args[0], score: points};
			}
			room.broadcast(user, `${this.scores[id].name}'s score is now ${this.scores[id].score}.`, rank);
		}
	},
	showmghpoints: function(message, args, user, rank, room, commandRank, commandRoom){
		let id = toId(args[0]);
		if(id){
			let entry = this.scores[id];
			if(entry){
				room.broadcast(user, `${entry.name}'s score is ${entry.score}.`, rank);
			}else{
				room.broadcast(user, `${entry.name} does not have a score.`, rank);
			}
		}else{
			let scores = [];
			for(let p in this.scores){
				scores.push(this.scores[p]);
			}
			scores.sort((e1,e2)=>{return e1.score < e2.score});
			if(scores.length == 0){
				room.broadcast(user, "No one has any points.", rank);
			}else{
				room.broadcast(user, `The current scores are: ${scores.map(e=>{return `__${e.name}__ (${e.score})`}).join(', ')}`, rank);
			}
		}
	},
	clearpoints: function(message, args, user, rank, room, commandRank, commandRoom){
		if(AuthManager.rankgeq(commandRank, this.config.rosterRank.value) && !this.voices[user.id]){
			this.scores = {};
			room.broadcast(user, "Cleared the current scores.", rank);
    	}
	},
	reghost: function(message, args, user, rank, room, commandRank, commandRoom){
		let host = commandRoom.getUserData(toId(args[0]));
		if(!AuthManager.rankgeq(commandRank, '%')){
			room.broadcast(user, "Your rank is not high enough to appoint a reghost.", rank);
		}else if(!host){
			room.broadcast(user, "You must give a user in Trivia to appoint as a reghost.", rank);
		}else if(AuthManager.getTrueRoomRank(host, commandRoom) !== ' '){
			room.broadcast(user, "That user already has a rank.", rank);
		}else if(this.hosts[host.id]){
			room.broadcast(user, "That user is already a reghost.", rank);
		}else if(Object.keys(this.hosts).length > 1){
			room.broadcast(user, "There cannot be more than two reghosts.", rank);
		}else if(!commandRoom){
			room.broadcast(user, "I'm not in Trivia currently.", rank);
		}else{
			this.hosts[host.id] = host;
			commandRoom.send(`/roomvoice ${host.id}`);
			room.broadcast(user, "Successfully added the host.", rank);
		}
	},
	endhost: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, '%')){
			room.broadcast(user, "Your rank is not high enough to end a reghost.", rank);
		}else{
			for(let host in this.hosts){
				commandRoom.send(`/roomdeauth ${this.hosts[host].id}`);
				this.hosts[host].rank = ' ';
				this.hosts[host].trueRank = ' ';
			}
			this.hosts = {};
			room.broadcast(user, "Successfully removed the hosts.", rank);
		}
	},
	modchat: function(message, args, user, rank, room, commandRank, commandRoom){
		let arg = toId(args[0]);
		if(!AuthManager.rankgeq(commandRank, '%')){
			room.broadcast(user, "Your rank is not high enough to turn on modchat.", rank);
		}else if(!commandRoom){
			room.broadcast(user, "I'm not in Trivia currently.", rank);
		}else{
			if(arg === 'on'){
				if(this.shouldVoice){
					room.broadcast(user, "Modchat is already on.", rank);
				}else{
					this.shouldVoice = true;
					for(let id in this.voices){
						commandRoom.send(`/roomvoice ${id}`);
					}
					commandRoom.send("/modchat +");
				}
			}else if(arg === 'off'){
				if(!this.shouldVoice){
					room.broadcast(user, "Modchat is already off.", rank);
				}else{
					this.shouldVoice = false;
					for(let id in this.voices){
						commandRoom.send(`/roomdeauth ${id}`);
						this.voices[id].rank = ' ';
						this.voices[id].trueRank = ' ';
					}
					commandRoom.send("/modchat ac");
				}
			}
		}
	},
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
			setTimeout(()=>{this.shouldStart = false;}, 1000);
		}
	},
	next: function(message, args, user, rank, room, commandRank, commandRoom){
		let timeDiff = (1457024400000-new Date().getTime())%14400000+14400000;
		let response = `The next official is (theoretically) in ${millisToTime(timeDiff)}.`;
		room.broadcast(user, response, rank, true);
	},
};

let millisToTime = function(millis){
	let seconds = millis/1000;
	let hours = Math.floor(seconds/3600);
	let minutes = Math.floor((seconds-hours*3600)/60);
	let response;
	if(hours>0){
		response = `${hours} hour${hours === 1 ? "" : "s"} and ${minutes} minute${minutes === 1 ? "" : "s"}`;
	}else{
		response = `${minutes} minute${minutes === 1 ? "" : "s"}`;
	}
	return response;
};

class MinigameHelper extends BaseModule{
	constructor(){
		super();
		this.room = MinigameHelper.room;
		this.config = {
			rosterRank: new ConfigRank('+'),
			officialReminders: new ConfigBoolean(true)
		};
		this.commands = commands;
		this.chathooks = {a: this.onChat};
		this.messagehooks = {a: this.onMessage};
		this.dependencies = ['tt'];
	}

	onLoad(){
		this.titanRegs = {};
		this.titanAuth = {};
		this.plist = [];
		this.maxplayers = 0;
		this.voices = {};
		this.scores = {};
		this.shouldVoice = false;
		this.hosts = {};

		if(!this.remindTimer && this.config.officialReminders.value){
			let timeDiff = (1457024400000-new Date().getTime())%14400000+14400000;
			this.remindTimer = setTimeout(()=>{
				this.remindTimer = null;
				this.officialReminder();
			}, timeDiff);
			info("Set the reminder for " + timeDiff/1000/60 + " minutes");
		}
	}

	onUnload(){
		let triviaRoom = RoomManager.getRoom("trivia");
		if(!triviaRoom) error("Minigamehelper unloaded, but wasn't in Trivia. Did any temporary voices get left behind?");
		if(this.shouldVoice){
			for(let id in this.voices){
				triviaRoom.send("/roomdeauth " + id);
			}
			triviaRoom.send("/modchat ac");
		}
		for(let id in this.hosts){
			triviaRoom.send("/roomdeauth " + id);
		}
		if(this.remindTimer){
			clearTimeout(this.remindTimer);
			this.remindTimer = null;
		}
	}

	recover(oldModule){
		this.shouldVoice = oldModule.shouldVoice;
		this.voices = oldModule.voices;
		this.hosts = oldModule.hosts;
		this.remindTimer = oldModule.remindTimer;
		this.titanRegs = oldModule.titanRegs;
		this.titanAuth = oldModule.titanAuth;
		this.plist = oldModule.plist;
		this.maxplayers = oldModule.maxplayers;
		this.joinTimer = oldModule.joinTimer;
		this.shouldStart = oldModule.shouldStart;
		this.scores = oldModule.scores;
	}

	onChat(room, user, message){
		let plist = this.plist;
		if(this.maxplayers && plist.length < this.maxplayers && room.id === this.room){
			let text = toId(message);
			if(text === "mein" && this.plist.length < this.maxplayers){
				let nplayers = this.plist.length;
				this.addPlayers([user.id], room);
				this.onPlayerChange(nplayers, room);
			}else if(text === "meout"){
				let nplayers = this.plist.length;
				this.removePlayers([user.id], room);
				this.onPlayerChange(nplayers, room);
			}
		}
	}

	onMessage(room, args){
		// If there are players:
		// |c|~|/raw <div class="infobox">There is a trivia game in progress, and it is in its signups phase.<br />Mode: Timer | Category: All | Score cap: 50<br />Players: Struchni (0)</div>
		// |c|~|/raw <div class="infobox">There is a trivia game in progress, and it is in its signups phase.<br />Mode: Timer | Category: All | Score cap: 50<br />Current score:  | Correct Answers: <br />Players: Struchni (0), Codex Necro (0)</div>
		if(this.shouldStart && room.id === 'trivia' && args.length > 2 && args[1] == 'c'){
			if(args[3].match(/in its signups phase/)){
				let matches = args[args.length-1].match(/<br \/>Players: (.*)<\/div>/);
				if(!matches) return;
				if(matches[1].length === 0){
					//info("No players");
				}else{
					//info(`${matches[1].split(',').length} players`);
					let num = matches[1].split(',').length;
					info(num);
					if(num > 2){
						this.startOfficial(room);
					}
				}
			}
		}
	}

	onPlayerChange(prevCount, room){
		if(this.plist.length !== prevCount){
			if(this.joinTimer){
				clearTimeout(this.joinTimer);
			}
			this.joinTimer = setTimeout(()=>{
				this.joinTimer = null;
				let numPlayers = this.plist.length;
				room.send(`There ${numPlayers === 1 ? "is" : "are"} now ${numPlayers} player${numPlayers === 1 ? "" : "s"} in the game.`);
			}, 5000);
		}
	}

	officialReminder(){
		let triviaRoom = RoomManager.getRoom(this.room);
		if(triviaRoom) triviaRoom.send("Time for the next official!");
		let timeDiff = (1457024400000-new Date().getTime())%14400000+14400000;
		if(timeDiff < 1000*60) timeDiff = 14400000;
		if(this.config.officialReminders.value) this.remindTimer = setTimeout(()=>{
			this.remindTimer = null;
			this.officialReminder();
		}, timeDiff);
		info("Set the reminder for " + timeDiff/1000/60 + " minutes");
	}

	startOfficial(room){
		room.send("/trivia start");
		room.send("**Triviastart, good luck! Remember to only answer using ``/ta`` or else you may be warned/muted!**");
		this.shouldStart = false;
	}

	removePlayers(names){
		if(names.length === 0) return "Player list not updated. You must give at least one player.";
		let triviaRoom = RoomManager.getRoom(this.room);
		for(let i=0;i<names.length;i++){
			let userId = toId(names[i]);
			if(this.voices[userId]){
				if(this.shouldVoice && triviaRoom){
					triviaRoom.send("/roomdeauth " + userId);
					this.voices[userId].rank = " ";
				}
				delete this.voices[userId];
			}
			if(this.scores[userId]) delete this.scores[userId]
			this.plist = this.plist.filter(item=>{return item.id !== userId});
		}
		let n = this.plist.length;
		return `Player list updated. There ${n==1?"is":"are"} now ${n} player${n==1?"":"s"}.`;
	}

	addPlayers(names, room){
		if(names.length === 0) return "Player list not updated. You must give at least one player.";
		let plist = this.plist;
		for(let i=0;i<names.length;i++){
			let user = room.getUserData(toId(names[i]));
			if(!user) continue;
			if(!this.voices[user.id] && user.trueRank === " "){
				this.voices[user.id] = user;
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
		return `Player list updated. There ${n==1?"is":"are"} now ${n} player${n==1?"":"s"}.`;
	}
}
MinigameHelper.room = 'trivia';

exports.Module = MinigameHelper;
