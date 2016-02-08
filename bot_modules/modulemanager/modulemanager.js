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
				if(text[0]==="~"){
					let command = text.split(" ")[0].trim().toLowerCase().substr(1);
					let chatArgs = text.substring(command.length+2, text.length).split(",");
					for(let i = 0;i<chatArgs.length;i++){
						chatArgs[i] = chatArgs[i].trim();
					}
					if(commands[command]&&auth&&auth.js){
						commands[command](m, chatArgs);
					}else if(commands[command]&&namesMatch(m.user,mainConfig.owner)){
						info("Circumventing auth check for module managing");
						commands[command](null, chatArgs);
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
	reload: function(message, args){
		if(args.length>0 && ((!message && (!auth || !auth.js)) || auth.js.rankgeq(auth.js.getGlobalRank(message.user),"#"))){
			let moduleName = normalizeText(args[0]);
			let result = loadModule(moduleName,false);
			if(result && moduleName !== "modulemanager"){
				if(self.data.modulesToLoad.indexOf(moduleName)==-1){
					self.data.modulesToLoad.add(moduleName);
					saveModuleList()
				}
			}
		}
	},
	load: function(message, args){
		if(args.length>0 && ((!message && (!auth || !auth.js)) || auth.js.rankgeq(auth.js.getGlobalRank(message.user),"#"))){
			let moduleName = normalizeText(args[0]);
			let result = loadModule(moduleName,true);
			if(result && moduleName !== "modulemanager"){
				if(self.data.modulesToLoad.indexOf(moduleName) === -1){
					self.data.modulesToLoad.add(moduleName);
					saveModuleList()
				}
			}
		}
	},
	unload: function(message, args){
		if(args.length>0 && ((!message && (!auth || !auth.js)) || auth.js.rankgeq(auth.js.getGlobalRank(message.user),"#"))){
			let moduleName = normalizeText(args[0]);
			let result = unloadModule(moduleName,true);
			if(result){
				let index = self.data.modulesToLoad.indexOf(moduleName);
				if(index !== -1){
					self.data.modulesToLoad.splice(index,1);
					saveModuleList()
				}
			}
		}
	}
};

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