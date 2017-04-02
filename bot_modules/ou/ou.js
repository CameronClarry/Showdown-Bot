let self = {js:{},data:{},requiredBy:[],hooks:{},config:{}};
let chat;
let auth;
let choices = ["Alakazam-Mega", "Buzzwole", "Celesteela", "Chansey", "Charizard-Mega-X", "Charizard-Mega-Y", "Dugtrio", "Excadrill", "Ferrothorn", "Garchomp", "Greninja", "Gyarados-Mega", "Heatran", "Hoopa-Unbound", "Jirachi", "Kartana", "Landorus-Therian", "Latios", "Magearna", "Magnezone", "Mamoswine", "Manaphy", "Marowak-Alola", "Metagross-Mega", "Mimikyu", "Muk-Alola", "Nihilego", "Pelipper", "Pheromosa", "Pinsir-Mega", "Rotom-Wash", "Sableye-Mega", "Salamence", "Scizor-Mega", "Scolipede", "Skarmory", "Tangrowth", "Tapu Bulu", "Tapu Fini", "Tapu Koko", "Tapu Lele", "Toxapex", "Tyranitar", "Venusaur-Mega", "Volcarona", "Xurkitree", "Zapdos", "Zygarde"];
const END_SECONDS = 7;
const DEFAULT_BID = 200;
const STARTING_CASH = 25000;
const ROOM = "ou";

// auction: {
// 	items: [],
// 	players: {p1:{
// 		money: 0,
// 		items: []
// 	}},
// 	price: 0,
// 	winner: "",
// 	active: false,
// 	endTimer: null
// }

exports.onLoad = function(module, loadData){
	self = module;
	self.js.refreshDependencies();
	if(loadData){
		self.data = {
			auction:{
				items: [],
				players: {},
				price: 0,
				winner: null,
				active: false,
				endTimer: null
			}};
	}
	self.chathooks = {
		chathook: function(m){
			if(m && !m.isInit){
				let text = m.message;
				if(text[0]==="."){
					let command = text.split(" ")[0].trim().toLowerCase().substr(1);
					let argText = text.substring(command.length+2, text.length);
					let chatArgs = argText === "" ? [] : argText.split(",");
					for(let i = 0;i<chatArgs.length;i++){
						chatArgs[i] = chatArgs[i].trim();
					}
					if(commands[command]&&auth&&auth.js&&chat&&chat.js){
						let rank = auth.js.getEffectiveRoomRank(m, "ou");
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
  chat = getModuleForDependency("chat", "ou");
  auth = getModuleForDependency("auth", "ou");
};

exports.onConnect = function(){

};

let commands = {
  randomize: function(message, args, rank){
    if(!auth.js.rankgeq(rank, "%")){
      chat.js.reply(message, "Your rank is not high enough to use that command.");
      return;
    }
    let arg = toId(args[0]);
    if(arg && arg === "on" || !arg && !self.data.ouOn){
      if(!self.data.ouOn){
        self.data.ouOn = true;
        self.data.ouTimer = setTimeout(sayPokes, 20000);
        chat.js.say(self.config.room, "You should have bid more.");
      }else{
        chat.js.reply(message, "It's already on.");
      }
    }else if(arg && arg === "off" || !arg && self.data.ouOn){
      if(self.data.ouOn){
        self.data.ouOn = false;
        if(self.data.ouTimer){
          clearTimeout(self.data.ouTimer);
          self.data.ouTimer = null;
        }
        chat.js.say(self.config.room, "Time's up!");
      }else{
        chat.js.reply(message, "It's already off.");
      }
    }
  },
  setprizes: function(message, args, rank){
		if(!auth.js.rankgeq(rank, "%")){
			chat.js.reply(message, "Your rank is not high enough to use that command.");
		}else{
			if(!args.length){
				chat.js.reply(message, "You must give at least one item.");
			}else{
				let auction = self.data.auction;
				auction.items = args;
				chat.js.reply(message, "Set the items to be actioned.");
			}
		}
  },
  setplayers: function(message, args, rank){
		if(!auth.js.rankgeq(rank, "%")){
			chat.js.reply(message, "Your rank is not high enough to use that command.");
		}else{
			if(args.length < 2){
				chat.js.reply(message, "You must give at least two players.");
			}else{
				let auction = self.data.auction;
				auction.players = {};
				for(let i=0;i<args.length;i++){
					auction.players[toId(args[i])] = {
						money: STARTING_CASH,
						items: [],
						displayName: args[i]
					}
				}
				chat.js.reply(message, "Set the players participating in the auction.");
			}
		}
  },
	nextitem: function(message, args, rank){
		let auction = self.data.auction;
		if(!auction || !auction.items || !auction.items.length){
			chat.js.reply(message, "There are no items up for auction.");
		}else{
			chat.js.reply(message, "The next item for auction is " + auction.items[0] + ".");
		}
	},
	startauction: function(message, args, rank){
		if(!auth.js.rankgeq(rank, "%")){
			chat.js.reply(message, "Your rank is not high enough to use that command.");
		}else{
			let auction = self.data.auction;
			if(auction.active){
				chat.js.reply(message, "The auction has already started.");
			}else if(!auction.items || !auction.items.length){
				chat.js.reply(message, "There are no items available to auction.");
			}else{
				auction.active = true;
				chat.js.say(self.config.room, "The auction has started. It will end " + END_SECONDS + " seconds after the last bid.");
			}
		}
	},
  bid: function(message, args, rank){
    let id = toId(message.user);
    let auction = self.data.auction;
    let players = auction && auction.players || [];
    let amountStr = args[0] || "" + DEFAULT_BID;
    if(!auction || !auction.active){
      chat.js.reply(message, "Bidding is not open right now.");
    }else if(!players[id]){
      chat.js.reply(message, "You are not in the auction.");
    }else if(!/^\d+$/.test(amountStr) || parseInt(amountStr)%DEFAULT_BID !== 0){
      chat.js.reply(message, "You must give a multiple of " + DEFAULT_BID + ".");
    }else{
      let amount = parseInt(amountStr) || DEFAULT_BID;
      if(players[id].money < auction.price + amount){
        chat.js.reply(message, "You don't have enough left to make that bid.");
      }else{
        auction.price += amount;
				auction.winner = message.user;
        chat.js.say(self.config.room, message.user + " has bid $" + auction.price + ".");
        if(auction.endTimer){
					clearTimeout(auction.endTimer);
				}
				auction.endTimer = setTimeout(endAuction, END_SECONDS*1000)
      }
    }
  }
};

let endAuction = function(){
	let auction = self.data.auction;
	let winner = auction.winner;
	let id = toId(winner);
	let player = auction.players[id];
	if(!id){
		chat.js.say(self.config.room, "No on bidded on the item.");
		auction.active = false;
		auction.winner = null;
		auction.price = 0;
		auction.endTimer = null;
	}else{
		let prize = auction.items.splice(0,1);
		player.items.push(prize);
		player.money -= auction.price;
		auction.active = false;
		auction.winner = null;
		auction.price = 0;
		auction.endTimer = null;
		let pArray = [];
		for(let id in auction.players){
			pArray.push(auction.players[id].displayName + ": $" + auction.players[id].money);
		}
		chat.js.say(self.config.room, "The auction is over, " + winner + " won " + prize + ". Here is how much money each player has left: " + pArray.join(", ") + ".");

	}
};

let sayPokes = function(){
  let tempArray = choices.slice(0);
  let num = Math.floor(Math.random()*tempArray.length);
  let item1 = tempArray.splice(num, 1)[0];
  num = Math.floor(Math.random()*tempArray.length);
  let item2 = tempArray.splice(num, 1)[0];
  num = Math.floor(Math.random()*tempArray.length);
  let item3 = tempArray.splice(num, 1)[0];
  chat.js.say(self.config.room, "Here are your three options: " + item1 + ", " + item2 + ", " + item3);
  self.data.ouTimer = setTimeout(sayPokes, 20000);
};

let defaultConfigs = {
	room: "ou"
};

exports.defaultConfigs = defaultConfigs;

let configTypes = {
	room: "string"
};

exports.configTypes = configTypes;
