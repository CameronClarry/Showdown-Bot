let fs = require("fs");
let self = {js:{},data:{},requiredBy:[],hooks:{},config:{}};
let chat = null;
let auth = null;
exports.onLoad = function(module, loadData){
	self = module;
	self.js.refreshDependencies();
	if(loadData){
		self.data = {};
		loadNews();
		loadQotd();
	}
	self.chathooks = {
		chathook: function(m){
			if(m && !m.isInit){
				let text = m.message;
				if(text[0]==="~"||text[0]==="."){
					let command = text.split(" ")[0].trim().toLowerCase().substr(1);
					let argText = text.substring(command.length+2, text.length);
					let chatArgs = argText === "" ? [] : argText.split(",");
					for(let i = 0;i<chatArgs.length;i++){
						chatArgs[i] = chatArgs[i].trim();
					}
					if(commands[command]&&auth&&auth.js&&chat&&chat.js){
						let rank = auth.js.getEffectiveRoomRank(m, "scholastic");
						let commandToRun = commands[command];
						if(typeof commandToRun === "string"){
							commandToRun = commands[commandToRun];
						}
						commandToRun(m, chatArgs, rank);
					}
				}
			}
		}
	};
};
exports.onUnload = function(){

};
exports.refreshDependencies = function(){
	chat = getModuleForDependency("chat", "scholastic");
	auth = getModuleForDependency("auth", "scholastic");
};
exports.onConnect = function(){

};

let commands = {
	article: "news",
	art: "news",
	na: "news",
	news: function(message, args, rank){
		if(args.length>0){
			if(auth.js.rankgeq(rank,"+")){
				let url = args.join(",");
				if(!self.data.news){
					self.data.news = [];
				}
				self.data.news.unshift({
					url: url,
					from: message.user,
					when: new Date().toUTCString()
				});
				saveNews();
				chat.js.reply(message, "Added this to the news list: " + url);
			}else{
				chat.js.reply(message, "You don't have the required rank in Scholastic to update the news.");
			}
		}else{
			let response = "This is not the place for news.";
			if(message.room === "scholastic" || message.room === "" || message.room === "joim"){
				if(self.data.news.length>0){
					response = self.data.news[Math.ceil(Math.pow(self.data.news.length+1, Math.random()))-2].url;
				}else{
						response = "There are no news articles.";
					}
			}
			chat.js.reply(message, response);
		}
	},
	qotd: function(message, args, rank){
		let response = "There is no question currently.";
		if(args.length){
			if(auth.js.rankgeq(rank,"@")){
				self.data.qotd.question = args[0];
				self.data.qotd.submissions = {};
				response = "Set the current question to be " + args[0] + ".";
				saveQotd();
			}else{
				response = "Your rank is not high enough to change the question.";
			}
		}else if(self.data.qotd.question){
			response = "Here is the question: " + self.data.qotd.question + ". To submit your answer, PM me ~submit followed by your answer, either as text or a link to a picture/pastebin/etc.";
		}
		chat.js.reply(message, response);
	},
	submit: function(message, args, rank){
		let response = "You need to include what you're submitting.";
		if(args.length){
			let user = toId(message.user);
			if(self.data.qotd.submissions[user]){
				response = "Your submission has been changed.";
			}else{
				response = "Your submission has been received.";
			}
			self.data.qotd.submissions[user] = {
				answer: args.join(","),
				user: message.user,
				date: new Date().toUTCString()
			};
			saveQotd();
		}
		chat.js.reply(message, response);
	},
	solution: function(message, args, rank){
		let response = "There is no solution currently.";
		if(args.length){
			if(auth.js.rankgeq(rank,"@")){
				self.data.qotd.solution = args[0];
				response = "Set the current solution to be " + args[0] + ".";
				saveQotd();
			}else{
				response = "Your rank is not high enough to change the solution.";
			}
		}else if(self.data.qotd.question){
			response = "Here is the solution to the previous question: " + self.data.qotd.solution + ". To submit your answer, PM me ~submit followed by your answer, either as text or a link to a picture/pastebin/etc.";
		}
		chat.js.reply(message, response);
	}
};

let saveNews = function(){
	try{
		let filename = "data/newslist.json";
		let newsFile = fs.openSync(filename,"w");
		fs.writeSync(newsFile,JSON.stringify(self.data.news, null, "\t"));
		fs.closeSync(newsFile);
	}catch(e){
		error(e.message);
	}
}

let loadNews = function(){
	let result = "Could not load the news list.";
	try{
		let filename = "data/newslist.json";
		if(fs.existsSync(filename)){
			self.data.news = JSON.parse(fs.readFileSync(filename, "utf8"));
			result = "Found and loaded the news list.";
		}else{
			self.data.news = [];
			let newsFile = fs.openSync(filename,"w");
			fs.writeSync(newsFile,JSON.stringify(self.data.news, null, "\t"));
			fs.closeSync(newsFile);
			result = "Could not find the news list file, made a new one.";
		}
	}catch(e){
		error(e.message);
	}
	info(result);
};

let saveQotd = function(){
	try{
		let filename = "data/qotd.json";
		let qotdFile = fs.openSync(filename,"w");
		fs.writeSync(qotdFile,JSON.stringify(self.data.qotd, null, "\t"));
		fs.closeSync(qotdFile);
	}catch(e){
		error(e.message);
	}
}

let loadQotd = function(){
	let result = "Could not load the question info.";
	try{
		let filename = "data/qotd.json";
		if(fs.existsSync(filename)){
			self.data.qotd = JSON.parse(fs.readFileSync(filename, "utf8"));
			result = "Found and loaded the question info.";
		}else{
			self.data.qotd = {
				question: "",
				submissions: []
			};
			let qotdFile = fs.openSync(filename,"w");
			fs.writeSync(qotdFile,JSON.stringify(self.data.qotd, null, "\t"));
			fs.closeSync(qotdFile);
			result = "Could not find the question info file, made a new one.";
		}
	}catch(e){
		error(e.message);
	}
	info(result);
};

let defaultConfigs = {
};

exports.defaultConfigs = defaultConfigs;

let configTypes = {
};

exports.configTypes = configTypes;
