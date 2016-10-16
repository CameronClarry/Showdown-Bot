let fs = getRequirement("fs");
let self = {js:{},data:{},requiredBy:[],hooks:{},config:{}};
info("CHAT STARTING");
let auth = null;
exports.onLoad = function(module, loadData){
	self = module;
	self.js.refreshDependencies();
	validateConfigs();
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

let validateConfigs = function(){
	let configs = self.config;
	info("VALIDATING");
	for(let optionName in defaultConfigs){
		if(typeof configs[optionName] !== typeof defaultConfigs[optionName]){
			configs[optionName] = defaultConfigs[optionName];
		}
	}
	saveConfig("chat");
};

let defaultConfigs = {
	roomResponseRank: "+"
};
