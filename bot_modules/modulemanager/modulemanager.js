let fs = getRequirement("fs");
let self = {js:{},data:{},requiredBy:[],hooks:{},config:{}};
let chat = null;
let auth = null;
info("STARTING MODULEMANAGER");
exports.onLoad = function(module, loadData){
	self = module;
	self.js.refreshDependencies();
	if(loadData){
	    self.data = {modulesToLoad: []};
	    loadModuleList();
	    loadAllModules();
	}
	self.chathooks = {
		chathook: function(m){
			if(m && !m.isInit){
				let text = m.message;
				if(text[0] === "~"){
					let words = text.split(" ");
					let command = words.shift().trim().toLowerCase().substr(1);
					let argText = words.join(" ");
					let chatArgs = argText === "" ? [] : argText.split(",").map(function(item){
						return item.trim();
					});
					if(commands[command] && auth && auth.js){
						commands[command](m, chatArgs);
					}else if(commands[command] && namesMatch(m.user,mainConfig.owner)){
						let response = "Circumvented auth check. Result: ";
						response += managerFuncs[command](chatArgs[0]);
						if(chat && chat.js){
							chat.js.reply(m, response);
						}else{
							info(response);
						}
					}
				}
			}
		}
	};

};
exports.onUnload = function(){

};
exports.refreshDependencies = function(){
	chat = getModuleForDependency("chat", "modulemanager");
	auth = getModuleForDependency("auth", "modulemanager");
};
exports.onConnect = function(){

};

let commands = {
	load: function(message, args){
		let response = "Your rank is not high enough to load modules.";
		if(auth.js.rankgeq(auth.js.getGlobalRank(message.user),"#")){
			response = "You must specify the module to be loaded.";
			if(args.length>0){
				response = managerFuncs.load(args[0]);
			}
		}
		if(chat&&chat.js){
			chat.js.reply(message, response);
		}
	},
	reload: function(message, args){
		let response = "Your rank is not high enough to load modules.";
		if(auth.js.rankgeq(auth.js.getGlobalRank(message.user),"#")){
			response = "You must specify the module to be loaded.";
			if(args.length>0){
				response = managerFuncs.reload(args[0]);
			}
		}
		if(chat&&chat.js){
			chat.js.reply(message, response);
		}
	},
	unload: function(message, args){
		let response = "Your rank is not high enough to unload a module.";
		if(auth.js.rankgeq(auth.js.getGlobalRank(message.user),"#")){
			response = "You must specify the module to unload.";
			if(args.length>0){
				response = managerFuncs.unload(args[0]);
			}
		}
		if(chat&&chat.js){
			chat.js.reply(message, response);
		}
	},
	config: function(message, args){
		let response = "Your rank is not high enough to reload configs.";
		if(auth.js.rankgeq(auth.js.getGlobalRank(message.user),"#")){
			response = "You must specify the module to reload the config for.";
			if(args.length>0){
				response = managerFuncs.config(args[0]);
			}
		}
		if(chat&&chat.js){
			chat.js.reply(message, response);
		}
	}
};

let managerFuncs = {
	load: function(name){
		let moduleName = normalizeText(name);
		let result = loadModule(moduleName,true);
		let response = "Something is wrong if you see this.";
		if(result && moduleName !== "modulemanager"){
			if(self.data.modulesToLoad.indexOf(moduleName) === -1){
				self.data.modulesToLoad.add(moduleName);
				saveModuleList();
				response = "Successfully loaded the module " + name + ".";
			}else{
				response = "Successfully reloaded the module " + name + " and its data.";
			}
		}else if(result){
			response = "Successfully loaded the module manager.";
		}else{
			response = "Could not load the module " + name + ".";
		}
		return response;
	},
	reload: function(name){
		let moduleName = normalizeText(name);
		let response = "Could not reload the module " + name + ".";
		if(!modules[moduleName] || (self.data.modulesToLoad.indexOf(moduleName) === -1 && moduleName !== "modulemanager")){
			response = managerFuncs.load(moduleName);
		}else{
			let result = loadModule(moduleName,false);
			if(result && moduleName !== "modulemanager"){
				response = "Successfully reloaded the module " + name + ".";
			}else if(result){
				response = "Successfully reloaded the module manager.";
			}
		}
		return response;
	},
	unload: function(name){
		let moduleName = normalizeText(name);
		let result = unloadModule(moduleName);
		let response = "Could not unload the module " + name + ".";
		if(result){
			response = "Successfully unloaded the module " + name + ".";
			let index = self.data.modulesToLoad.indexOf(moduleName);
			if(index !== -1){
				self.data.modulesToLoad.splice(index,1);
				saveModuleList();
			}
		}
		return response;
	},
	config: function(name){
		let result = loadConfig(name);
		let response = "Could not reload the config for " + name + ".";
		if(result){
			response = "Successfully reloaded the config for " + name + ".";
		}
		return response;
	}
}

let loadModuleList = function(){
		try{
			let filename = "bot_modules/modulemanager/modules.json";
			if(fs.existsSync(filename)){
				self.data.modulesToLoad = JSON.parse(fs.readFileSync(filename, "utf8"));
				ok("Successfully loaded the module list.");
			}else{
				self.data.modulesToLoad = [];
				let moduleFile = fs.openSync(filename,"w");
				fs.writeSync(moduleFile,JSON.stringify(self.data.modulesToLoad, null, "\t"));
				fs.closeSync(moduleFile);
				error("No module list found, saved a new one.")
			}
		}catch(e){
			error(e.message);
			error("Could not load the module list.")
		}
};

let saveModuleList = function(){
	try{
		let filename = "bot_modules/modulemanager/modules.json";
		let moduleFile = fs.openSync(filename,"w");
		fs.writeSync(moduleFile,JSON.stringify(self.data.modulesToLoad, null, "\t"));
		fs.closeSync(moduleFile);
		ok("Saved the module list.");
	}catch(e){
		error(e.message);
		error("Could not save the module list.");
	}
};

let loadAllModules = function(){
	for(let i=0;i<self.data.modulesToLoad.length;i++){
		let moduleName = self.data.modulesToLoad[i];
		let result = loadModule(moduleName, true);
		if(!result){
			self.data.modulesToLoad.splice(i,1);
			i--;
			error("Could not load the module '" + moduleName + "'.");
			continue;
		}
		ok("Loaded the module '" + moduleName + "'.");
	}
};
