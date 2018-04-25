let fs = require("fs");
let self = {js:{},data:{},requiredBy:[],hooks:{},config:{}};
let auth = null;
exports.onLoad = function(module, loadData){
	self = module;
	self.js.refreshDependencies();
	if(loadData){

	}
	self.chathooks = {

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

// This will reply in chat if the user is the required rank in the room, otherwise it will PM
let reply = function(message, text, overrideRank){
	if(auth && auth.js){
		let rank = overrideRank || auth.js.getEffectiveRoomRank(message, message.room);
		if(auth.js.rankgeq(rank, self.config.roomResponseRank) && message.room !== ""){
			say(message.room, text);
		}else{
			pm(message.user, text);
		}
	}else{
		info("No auth module, defaulting to PM.");
		pm(message.user, text);
	}
};
exports.reply = reply;

// Similar to reply, but if the permission fails it will ask the user to retry in PMs
let strictReply = function(message, text, overrideRank){
	if(message.room === ""){
		pm(message.user, text)
	}else if(auth && auth.js){
		let rank = overrideRank || auth.js.getEffectiveRoomRank(message, message.room);
		if(auth.js.rankgeq(rank, self.config.roomResponseRank)){
			say(message.room, text);
		}else{
			pm(message.user, "Please only use that command through PMs.");
		}
	}else{
		info("No auth module, defaulting to PM.");
		pm(message.user, text);
	}
};
exports.strictReply = strictReply;

let defaultConfigs = {
	roomResponseRank: "+"
};

exports.defaultConfigs = defaultConfigs;

let configTypes = {
	roomResponseRank: "rank"
};

exports.configTypes = configTypes;
