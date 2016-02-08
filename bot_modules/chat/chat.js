let fs = getRequirement("fs");
let self = {js:{},data:{},requiredBy:[],hooks:{},config:{}};
info("CHAT STARTING");
let auth = null;
exports.onLoad = function(module, loadData){
	self = module;
	self.js.refreshDependencies();
	if(loadData){
	    
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
					if(chatCommands[command]){
						chatCommands[command](m, chatArgs);
					}
				}
			}
		}
	};
};
exports.onUnload = function(){
    
};
exports.refreshDependencies = function(){
    auth = getModuleForDependency("auth","chat");
};

let say = function(room, message){
	send(room+"|"+message);
};
exports.say = say;

let pm = function(user, message){
	send("|/pm " + user + "," + message);
};
exports.pm = pm;

let attemptAnnounce = function(room, user, message, rank, minRank){
	if(!rank){
		rank = auth.js.getRank(user, room);
	}
	if(!minRank){
		minRank = "+";
	}
	if(auth.js.rankgeq(rank,minRank)&&room){
		say(room, message);
	}else if(user){
		pm(user, message);
	}else{
		info("Could not send this message to a room or user: " + message);
	}
};
exports.attemptAnnounce = attemptAnnounce;

let reply = function(message, text){
	let rank = auth.js.getEffectiveRoomRank(message, message.room);
	if(auth.js.rankgeq(rank, "+") && message.room !== ""){
		say(message.room, text);
	}else{
		pm(message.user, text);
	}
};
exports.reply = reply;

let chatCommands = {
	say: function(message, args){
		reply(message, "no");
	}
};