// {{{ VERSION MOVE DIFFERENCES


let pokemonByVersionMoveDifferences = function(callback){
	const EXCLUSIVE_LEVELUP_MOVE = `SELECT pokemon.name, ms1.pokemon_id, ms1.game_name, moves.name AS move_name
	FROM movesets AS ms1
	INNER JOIN moves ON ms1.move_id = moves.id
	INNER JOIN pokemon ON ms1.pokemon_id = pokemon.id
	LEFT JOIN movesets AS ms2 ON ms1.pokemon_id = ms2.pokemon_id AND ms1.move_id = ms2.move_id AND ms1.game_name != ms2.game_name AND ms2.learn_method = 1
	WHERE ms1.game_name != 'rby'
	AND ms1.learn_method = 1
	AND ms2.pokemon_id IS NULL;`;

	let newCallback = (err, res) =>{
		if(err){
			callback(err);
			return;
		}

		// Get array of rows and pick one randomly
		let rows = res.rows;
		let row = rows[Math.floor(Math.random()*rows.length)];

		// Filter to just rows that have that pokemon and game
		filteredRows = rows.filter((e)=>{return e.pokemon_id === row.pokemon_id && e.game_name === row.game_name});
		pokemonName = row.name;
		gameName = row.game_name === 'y' ? 'Pokemon Yellow' : 'Pokemon Red and Blue';
		answers = filteredRows.map((e)=>{return e.move_name});
		question = `In Generation I, ${pokemonName} learns this move by level up only in ${gameName}.`;

		callback(null, question, answers);
	};
	this.pgclient.runSql(EXCLUSIVE_LEVELUP_MOVE , [], newCallback);
};

// }}} 

// {{{ SIGNATURE MOVES


let signatureMoves = function(callback){
	const EXCLUSIVE_MOVE = `WITH family_counts AS (
		SELECT moves.name AS move_name, COUNT(DISTINCT pokemon.family_id) AS family_count, COUNT(DISTINCT pokemon.id)::int AS pokemon_count, MAX(pokemon.family_id) AS family_id, MAX(pokemon.id) AS pokemon_id
		FROM movesets
		INNER JOIN moves ON moves.id = movesets.move_id
		INNER JOIN pokemon ON pokemon.id = movesets.pokemon_id
		GROUP BY moves.name
	)
	SELECT move_name, family_count, pokemon_count, families.name AS family_name, pokemon.name AS pokemon_name
	FROM family_counts
	INNER JOIN families ON families.id = family_counts.family_id
	INNER JOIN pokemon ON pokemon.id = family_counts.pokemon_id
	WHERE family_count = 1;`;

	let newCallback = (err, res) =>{
		if(err){
			callback(err);
			return;
		}

		// Get array of rows and pick one randomly
		let rows = res.rows;
		let row = rows[Math.floor(Math.random()*rows.length)];

		// Filter to just rows that have that pokemon and game
		filteredRows = rows.filter((e)=>{return e.family_name === row.family_name});

		let question, answers;
		if(Math.random() < 0.5){
			// Ask which line/pokemon
			//let ending = row.pokemon_count === 1 ? `unique to ${row.pokemon_name}` : `signature to the ${row.family_name} line`;
			let ending = row.pokemon_count === 1 ? `unique to this Pokemon` : `signature to this evolutionary line`;
			question = `In Generation I, ${row.move_name} is ${ending}.`
			answers = filteredRows.map((e)=>{return row.pokemon_count === 1 ? row.pokemon_name : row.family_name});
		}else{
			// Ask which move
			let ending = row.pokemon_count === 1 ? `unique to ${row.pokemon_name}` : `signature to the ${row.family_name} line`;
			question = `In Generation I, this move is ${ending}.`;
			answers = filteredRows.map((e)=>{return e.move_name});
		}

		callback(null, question, answers);
	};
	this.pgclient.runSql(EXCLUSIVE_MOVE, [], newCallback);
};

// }}}

// {{{ FINAL LEVEL UP MOVES


let finalLevelUpMove = function(callback){
	const FINAL_LEVEL_UP_MOVE = `WITH max_levels AS (
		SELECT MAX(learn_level) AS max_level, pokemon_id
		FROM movesets
		GROUP BY pokemon_id
	)
	SELECT pokemon.name, pokemon.short_name, moves.name AS move_name, movesets.game_name, movesets.learn_level
	FROM pokemon
	INNER JOIN max_levels ON max_levels.pokemon_id = pokemon.id
	INNER JOIN movesets ON pokemon.id = movesets.pokemon_id AND movesets.learn_level = max_levels.max_level
	INNER JOIN moves ON moves.id = movesets.move_id
	WHERE movesets.learn_method = 1
	AND max_levels.max_level > 1;`;

	let newCallback = (err, res) =>{
		if(err){
			callback(err);
			return;
		}

		// Get array of rows and pick one randomly
		let rows = res.rows;
		let row = rows[Math.floor(Math.random()*rows.length)];

		let question = `This is the final move that ${row.name} learns by level up in Generation I.`;
		let answers = [row.move_name];

		callback(null, question, answers);
	};
	this.pgclient.runSql(FINAL_LEVEL_UP_MOVE, [], newCallback);
}

// }}}

// {{{ LEARNS MOVE

let twoMovePokemon = function(move1_id, move1_name, move2_id, move2_name, callback){
	const TWO_MOVE_LEARN_COUNTS = `SELECT DISTINCT pokemon.name
	FROM movesets AS ms1
	INNER JOIN movesets AS ms2 ON ms1.pokemon_id = ms2.pokemon_id
	INNER JOIN pokemon ON pokemon.id = ms1.pokemon_id
	WHERE ms1.learn_method = 1 AND ms1.move_id = ${move1_id}
	AND ms2.learn_method = 1 AND ms2.move_id = ${move2_id};`;

	let newCallback = (err, res) =>{
		if(err){
			callback(err);
			return;
		}

		// Get array of rows
		let rows = res.rows;

		let question = `In Generation I, this Pokemon learns both ${move1_name} and ${move2_name} by level up.`;
		let answers = rows.map((e)=>{return e.name});

		callback(null, question, answers);
	};
	this.pgclient.runSql(TWO_MOVE_LEARN_COUNTS, [], newCallback);
}

let twoMoveCounts = function(move_id, move_name, callback){
	const TWO_MOVE_LEARN_COUNTS = `SELECT moves2.name AS move_name, ms2.move_id AS move_id, COUNT(DISTINCT ms2.pokemon_id)::int AS learn_num
	FROM movesets AS ms1
	INNER JOIN movesets AS ms2 ON ms1.pokemon_id = ms2.pokemon_id AND ms2.learn_method = 1
	INNER JOIN moves AS moves2 ON moves2.id = ms2.move_id
	WHERE ms1.move_id = ${move_id} AND ms1.learn_method = 1 AND ms2.move_id != ms1.move_id
	GROUP BY ms2.move_id, moves2.name;`;

	let newCallback = (err, res) =>{
		if(err){
			callback(err);
			return;
		}

		// Get array of rows
		let rows = res.rows;

		let row = rows[Math.floor(Math.random()*rows.length)];

		twoMovePokemon.call(this, move_id, move_name, row.move_id, row.move_name, callback);
	};
	this.pgclient.runSql(TWO_MOVE_LEARN_COUNTS, [], newCallback);
}

let moveCounts = function(callback){
	const MOVE_LEARN_COUNTS = `SELECT moves.name AS move_name, moves.id AS move_id, COUNT(DISTINCT pokemon_id)::int AS learn_num, COUNT(DISTINCT family_id)::int AS family_num
	FROM movesets
	INNER JOIN pokemon ON pokemon.id = movesets.pokemon_id
	INNER JOIN moves ON moves.id = movesets.move_id
	WHERE learn_method = 1
	GROUP BY moves.name, moves.id;`;

	let newCallback = (err, res) =>{
		if(err){
			callback(err);
			return;
		}

		// Get array of rows
		let rows = res.rows;
		// We don't want rows that are signature or exclusive
		let filteredRows = rows.filter((e)=>{return e.family_num > 1});

		let row = filteredRows[Math.floor(Math.random()*filteredRows.length)];

		// Decide how to handle the row
		twoMoveCounts.call(this, row.move_id, row.move_name, callback);
	};
	this.pgclient.runSql(MOVE_LEARN_COUNTS, [], newCallback);
}

// }}}

// {{{ LEVEL 1 MOVES

let firstLevelMove = function(callback){
	const LEVEL_ONE_MOVE = `SELECT pokemon.name, pokemon.short_name, moves.name AS move_name
	FROM pokemon
	INNER JOIN movesets ON pokemon.id = movesets.pokemon_id
	INNER JOIN moves ON moves.id = movesets.move_id
	WHERE movesets.learn_method = 1
	AND movesets.learn_level = 1;`;

	let newCallback = (err, res) =>{
		if(err){
			callback(err);
			return;
		}

		// Get array of rows and pick one randomly
		let rows = res.rows;
		let row = rows[Math.floor(Math.random()*rows.length)];
		let question, answers;

		if(Math.random() < 0.5){
			// Ask which pokemon
			filteredRows = rows.filter((e)=>{return e.move_name === row.move_name});
			question = `In Generation I, this Pokemon learns ${row.move_name} at level 1.`
			answers = filteredRows.map((e)=>{return e.short_name});
		}else{
			// Ask which move
			filteredRows = rows.filter((e)=>{return e.short_name === row.short_name});
			question = `In Generation I, ${row.name} learns this move at level 1.`;
			answers = filteredRows.map((e)=>{return e.move_name});
		}

		callback(null, question, answers);
	};
	this.pgclient.runSql(LEVEL_ONE_MOVE, [], newCallback);
}

// }}}

// {{{ MOVE LEARNING BY TYPE

let typeMovePokemon = function(type_id, type_name, max_learns, callback){
	const TYPE_LEARN_POKEMON = `WITH same_type_moves AS (
		SELECT pokemon.id AS pokemon_id, pokemon.name AS pokemon_name, types.id AS type_id, types.name AS type_name, COUNT(DISTINCT movesets.move_id) AS move_counts
		FROM movesets
		INNER JOIN pokemon ON pokemon.id = movesets.pokemon_id
		INNER JOIN moves ON moves.id = movesets.move_id
		INNER JOIN types ON types.id = moves.type_id
		WHERE (moves.type_id = pokemon.type1_id OR moves.type_id = pokemon.type2_id AND pokemon.type2_id IS NOT NULL)
		AND moves.type_id = ${type_id}
		GROUP BY pokemon.id, types.id
	)
	SELECT pokemon_name
	FROM same_type_moves
	WHERE move_counts = ${max_learns};`;

	let newCallback = (err, res) =>{
		if(err){
			callback(err);
			return;
		}

		// Get array of rows
		let rows = res.rows;

		let row = rows[Math.floor(Math.random()*rows.length)];

		let question = `In Generation I, this Pokemon learns the most ${type_name}-type moves of all ${type_name}-type Pokemon.`;

		let answers = rows.map(e=>{return e.pokemon_name});

		callback(null, question, answers);
	};
	this.pgclient.runSql(TYPE_LEARN_POKEMON, [], newCallback);
}

let typeMoveCounts = function(callback){
	const TYPE_LEARN_COUNTS = `WITH same_type_moves AS (
		SELECT pokemon.id AS pokemon_id, pokemon.name AS pokemon_name, types.id AS type_id, types.name AS type_name, COUNT(DISTINCT movesets.move_id)::int AS move_counts
		FROM movesets
		INNER JOIN pokemon ON pokemon.id = movesets.pokemon_id
		INNER JOIN moves ON moves.id = movesets.move_id
		INNER JOIN types ON types.id = moves.type_id
		WHERE (moves.type_id = pokemon.type1_id OR moves.type_id = pokemon.type2_id AND pokemon.type2_id IS NOT NULL)
		AND moves.type_id != 14 AND moves.type_id != 15 --There are very few ghost / dragon Pokemon
		GROUP BY pokemon.id, types.id
	)
	SELECT type_id, type_name, MIN(move_counts)::int AS min_learns, MAX(move_counts)::int AS max_learns
	FROM same_type_moves
	GROUP BY type_id, type_name;`;

	let newCallback = (err, res) =>{
		if(err){
			callback(err);
			return;
		}

		// Get array of rows
		let rows = res.rows;

		let row = rows[Math.floor(Math.random()*rows.length)];

		// Decide how to handle the row
		typeMovePokemon.call(this, row.type_id, row.type_name, row.max_learns, callback);
	};
	this.pgclient.runSql(TYPE_LEARN_COUNTS, [], newCallback);
}

// }}}

exports.questionTypes = [
	{
		func: pokemonByVersionMoveDifferences,
		weight: 1
	},
	{
		func: signatureMoves,
		weight: 3
	},
	{
		func: finalLevelUpMove,
		weight: 3
	},
	{
		func: moveCounts,
		weight: 3
	},
	{
		func: firstLevelMove,
		weight: 3
	},
	{
		func: typeMoveCounts,
		weight: 3
	}
];
