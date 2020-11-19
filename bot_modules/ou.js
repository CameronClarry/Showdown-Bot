let choices = ["Alakazam-Mega", "Buzzwole", "Celesteela", "Chansey", "Charizard-Mega-X", "Charizard-Mega-Y", "Dugtrio", "Excadrill", "Ferrothorn", "Garchomp", "Greninja", "Gyarados-Mega", "Heatran", "Hoopa-Unbound", "Jirachi", "Kartana", "Landorus-Therian", "Latios", "Magearna", "Magnezone", "Mamoswine", "Manaphy", "Marowak-Alola", "Metagross-Mega", "Mimikyu", "Muk-Alola", "Nihilego", "Pelipper", "Pheromosa", "Pinsir-Mega", "Rotom-Wash", "Sableye-Mega", "Salamence", "Scizor-Mega", "Scolipede", "Skarmory", "Tangrowth", "Tapu Bulu", "Tapu Fini", "Tapu Koko", "Tapu Lele", "Toxapex", "Tyranitar", "Venusaur-Mega", "Volcarona", "Xurkitree", "Zapdos", "Zygarde"];
const END_SECONDS = 7;
const DEFAULT_BID = 200;
const STARTING_CASH = 25000;

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

let commands = {
	randomize: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, '%')){
			this.ouRoom.broadcast(user, "Your rank is not high enough to use that command.");
			return;
		}
		let arg = toId(args[0]);
		if(arg === 'on' || !arg && !this.ouOn){
			if(!this.ouOn){
				this.ouOn = true;
				this.ouTimer = setTimeout(this.sayPokes, 20000);
				this.ouRoom.send("You should have bid more.");
			}else{
				this.ouRoom.broadcast(user, "It's already on.");
			}
		}else if(arg === 'off' || !arg && this.ouOn){
			if(this.ouOn){
				this.ouOn = false;
				if(this.ouTimer){
					clearTimeout(this.ouTimer);
					this.ouTimer = null;
				}
				this.ouRoom.send("Time's up!");
			}else{
				this.ouRoom.broadcast(user, "It's already off.");
			}
		}
	},
	setprizes: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, '%')){
			this.ouRoom.broadcast(user, "Your rank is not high enough to use that command.");
		}else{
			if(!args.length){
				this.ouRoom.broadcast(user, "You must give at least one item.");
			}else{
				let auction = this.auction;
				auction.items = args;
				this.ouRoom.broadcast(user, "Set the items to be actioned.");
			}
		}
	},
	setplayers: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, '%')){
			this.ouRoom.broadcast(user, "Your rank is not high enough to use that command.");
		}else{
			if(args.length < 2){
				this.ouRoom.broadcast(user, "You must give at least two players.");
			}else{
				let auction = this.auction;
				auction.players = {};
				for(let i=0;i<args.length;i++){
					auction.players[toId(args[i])] = {
						money: STARTING_CASH,
						items: [],
						displayName: args[i]
					}
				}
				this.ouRoom.broadcast(user, "Set the players participating in the auction.");
			}
		}
	},
	nextitem: function(message, args, user, rank, room, commandRank, commandRoom){
		let auction = this.auction;
		if(!auction || !auction.items || !auction.items.length){
			this.ouRoom.broadcast(user, "There are no items up for auction.");
		}else{
			this.ouRoom.broadcast(user, `The next item for auction is ${auction.items[0]}.`);
		}
	},
	startauction: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, '%')){
			this.ouRoom.broadcast(user, "Your rank is not high enough to use that command.");
		}else{
			let auction = this.auction;
			if(auction.active){
				this.ouRoom.broadcast(user, "The auction has already started.");
			}else if(!auction.items || !auction.items.length){
				this.ouRoom.broadcast(user, "There are no items available to auction.");
			}else{
				auction.active = true;
				this.ouRoom.send(`The auction has started. It will end ${END_SECONDS} seconds after the last bid.`);
			}
		}
	},
	bid: function(message, args, user, rank, room, commandRank, commandRoom){
		let id = user.id;
		let auction = this.auction;
		let players = auction && auction.players || [];
		let amountStr = args[0] || DEFAULT_BID.toString();
		if(!auction || !auction.active){
			this.ouRoom.broadcast(user, "Bidding is not open right now.");
		}else if(!players[id]){
			this.ouRoom.broadcast(user, "You are not in the auction.");
		}else if(!/^\d+$/.test(amountStr) || parseInt(amountStr)%DEFAULT_BID !== 0){
			this.ouRoom.broadcast(user, `You must give a multiple of ${DEFAULT_BID}.`);
		}else{
			let amount = parseInt(amountStr) || DEFAULT_BID;
			if(players[id].money < auction.price + amount){
				this.ouRoom.broadcast(user, "You don't have enough left to make that bid.");
			}else{
				auction.price += amount;
				auction.winner = user.name;
				this.ouRoom.send(`${user.name} has bid $${auction.price}.`);
				if(auction.endTimer){
					clearTimeout(auction.endTimer);
				}
				auction.endTimer = setTimeout(endAuction, END_SECONDS*1000)
			}
		}
	}
};

let endAuction = function(){
	let auction = this.auction;
	let winner = auction.winner;
	let id = toId(winner);
	let player = auction.players[id];
	if(!id){
		this.ouRoom.send("No one bid on the item.");
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
			pArray.push(`${auction.players[id].displayName}: $${auction.players[id].money}`);
		}
		this.ouRoom.send(`The auction is over, ${winner} won ${prize}. Here is how much money each player has left: ${pArray.join(', ')}.`);
	}
};

class OU extends BaseModule{
	constructor(){
		super();
		this.room = OU.room;
		this.config = {};
		this.commands = commands;
		this.ouRoom = RoomManager.getRoom(this.room);
	}

	onLoad(){
		this.auction = {
			items: [],
			players: {},
			price: 0,
			winner: null,
			active: false,
			endTimer: null
		};
	}

	sayPokes(){
		let tempArray = choices.slice(0);
		let num = Math.floor(Math.random()*tempArray.length);
		let item1 = tempArray.splice(num, 1)[0];
		num = Math.floor(Math.random()*tempArray.length);
		let item2 = tempArray.splice(num, 1)[0];
		num = Math.floor(Math.random()*tempArray.length);
		let item3 = tempArray.splice(num, 1)[0];
		this.ouRoom.send(`Here are your three options: ${item1}, ${item2}, ${item3}`);
		this.ouTimer = setTimeout(this.sayPokes, 20000);
	};
}
OU.room = 'overused';

exports.Module = OU;
