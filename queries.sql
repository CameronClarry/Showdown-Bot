--TABLE CREATION QUERIES

CREATE TABLE users(id SERIAL PRIMARY KEY, username VARCHAR(20) NOT NULL, display_name VARCHAR(20) NOT NULL);

CREATE TABLE alts(username VARCHAR(20) PRIMARY KEY NOT NULL, main_id INT NOT NULL);

CREATE TABLE tt_points(id INT NOT NULL, leaderboard VARCHAR(20) NOT NULL, points INT NOT NULL, PRIMARY KEY(id, leaderboard));

CREATE TABLE tt_leaderboards(id VARCHAR(20) PRIMARY KEY NOT NULL, display_name VARCHAR(20) NOT NULL, created_on TIMESTAMP NOT NULL, created_by INT NOT NULL, enabled BOOLEAN NOT NULL);

CREATE TABLE leaderboard_aliases(alias_id VARCHAR(20) PRIMARY KEY, leaderboard_id VARCHAR(20), CONSTRAINT fk_leaderboard_id FOREIGN KEY(leaderboard_id) REFERENCES tt_leaderboards(id) ON DELETE CASCADE ON UPDATE CASCADE);

CREATE TABLE wl_lb(id INT PRIMARY KEY NOT NULL, correct INTEGER NOT NULL, incorrect INTEGER NOT NULL, passed INTEGER NOT NULL, wins INTEGER NOT NULL, banked INTEGER NOT NULL, won INTEGER NOT NULL);

CREATE TABLE achievement_list(id SERIAL PRIMARY KEY, name VARCHAR(40) NOT NULL, name_id VARCHAR(40) NOT NULL UNIQUE, description VARCHAR(300) NOT NULL, value INT NOT NULL);

CREATE TABLE player_achievements(player_id INT NOT NULL, achievement_id INT NOT NULL, date_achieved TIMESTAMP NOT NULL, PRIMARY KEY(player_id, achievement_id));

--####################
--USER AND ALT QUERIES
--####################

--INSERT_USER_SQL
INSERT INTO users (username, display_name) VALUES ($1, $2);

--DELETE_USER_SQL
DELETE FROM users WHERE id = $1;

--INSERT_ALT_SQL
INSERT INTO alts (username, main_id) VALUES ($1, (SELECT id FROM users WHERE username = $2 FETCH FIRST 1 ROWS ONLY));

--DELETE_ALT_SQL
DELETE FROM alts WHERE username = $1;

--GET_USER_SQL
SELECT users.id, users.username, users.display_name FROM alts INNER JOIN users ON alts.main_id = users.id WHERE alts.username = $1 FETCH FIRST 1 ROWS ONLY;

--GET_ALTS_SQL
SELECT username FROM alts WHERE main_id = $1;

--UPDATE_USER_SQL
UPDATE users SET display_name = $2, username = $3 WHERE id = $1;

--UPDATE_MAINS_SQL
UPDATE alts SET main_id = $2 WHERE main_id = $1;

--GET_MAINS_SQL
SELECT alts.username, id, display_name, TRUE AS is_first FROM alts INNER JOIN users ON alts.main_id = users.id WHERE alts.username = $1 UNION SELECT alts.username, id, display_name, FALSE AS is_first FROM alts INNER JOIN users ON alts.main_id = users.id WHERE alts.username = $2;

--###################
--LEADERBOARD QUERIES
--###################

--INSERT_LB_SQL
INSERT INTO tt_leaderboards VALUES($1, $2, CURRENT_TIMESTAMP, $3, true);

--DELETE_LB_SQL
DELETE FROM tt_leaderboards WHERE id = $1;

--GET_LB_SQL
SELECT lb.id, lb.display_name, lb.created_on, users.display_name AS created_by, lb.enabled FROM leaderboard_aliases AS aliases INNER JOIN tt_leaderboards AS lb ON aliases.leaderboard_id = lb.id LEFT OUTER JOIN users ON lb.created_by = users.id WHERE aliases.alias_id = $1;

--GET_ALL_LB_SQL
SELECT * FROM tt_leaderboards;

--GET_ACTIVE_LB_SQL
SELECT * FROM tt_leaderboards WHERE enabled = TRUE;

--RESET_MAIN_LB_SQL
UPDATE tt_leaderboards SET created_on = CURRENT_TIMESTAMP, created_by = $3 WHERE id = 'main';

--UPDATE_LB_SQL
UPDATE tt_leaderboards SET enabled = $2 WHERE id = $1;

--#################
--TT_POINTS QUERIES
--#################

--GET_LB_ENTRY_SQL
SELECT lb.points, users.display_name FROM tt_points AS lb LEFT OUTER JOIN users ON lb.id = users.id WHERE lb.id = $1 AND lb.leaderboard = $2;

--GET_LB_ENTRIES_SQL
SELECT lb.points, users.display_name FROM tt_points AS lb INNER JOIN leaderboard_aliases AS aliases ON lb.leaderboard = aliases.leaderboard_id LEFT OUTER JOIN users ON lb.id = users.id WHERE aliases.alias_id = $1 AND lb.points > 0 ORDER BY lb.points DESC;

--GET_ALL_LB_ENTRIES_SQL
SELECT lb.points, users.display_name FROM tt_points AS lb LEFT OUTER JOIN users ON lb.id = users.id WHERE leaderboard = $1 AND lb.points > 0 ORDER BY lb.points DESC;

--LSIT_LB_ENTRIES_SQL
SELECT lb.points, users.display_name, tt_leaderboards.display_name AS lb_name FROM tt_points AS lb INNER JOIN leaderboard_aliases AS aliases ON lb.leaderboard = aliases.leaderboard_id LEFT OUTER JOIN users ON lb.id = users.id LEFT OUTER JOIN tt_leaderboards ON lb.leaderboard = tt_leaderboards.id WHERE aliases.alias_id = $1 AND lb.points > 0 ORDER BY lb.points DESC FETCH FIRST _NUMBER_ ROWS ONLY;

--INSERT_LB_ENTRY_SQL
INSERT INTO tt_points VALUES ($1, $2, $3);

--UPDATE_LB_ENTRY_SQL
UPDATE tt_points SET points = $3 WHERE id = $1 AND leaderboard = $2;

--DELETE_LB_ENTRY_SQL
DELETE FROM tt_points WHERE id = $1 AND leaderboard = $2;

--DELETE_USER_ENTRIES_SQL
DELETE FROM tt_points WHERE id = $1;

--DELETE_LB_ENTRIES_SQL
DELETE FROM tt_points WHERE leaderboard = $1;

--GET_ALL_LB_ENTRIES_SQL
SELECT lb.points, users.display_name FROM tt_points AS lb LEFT OUTER JOIN users ON lb.id = users.id WHERE lb.leaderboard = $1 ORDER BY lb.points DESC;

--###################
--ACHIEVEMENT QUERIES
--###################

--INSERT_ACHIEVEMENT_SQL
INSERT INTO achievement_list VALUES (DEFAULT, $1, $2, $3, $4);

--DELETE_ACHIEVEMENT_SQL
DELETE FROM achievement_list WHERE name_id = $1;

--GET_ALL_ACHIEVEMENTS_SQL
SELECT * FROM achievement_list;

--GET_ACHIEVEMENT_BY_NAME_SQL
SELECT * FROM achievement_list WHERE name_id = $1;

--INSERT_PLAYER_ACHIEVEMENT_SQL
INSERT INTO player_achievements VALUES ($1, $2, CURRENT_TIMESTAMP);

--DELETE_PLAYER_ACHIEVEMENT_SQL
DELETE FROM player_achievements WHERE player_id = $1 AND achievement_id = $2;

--DELETE_ACHIEVEMENT_BY_NAME_SQL
DELETE FROM player_achievements WHERE achievement_id = (SELECT id FROM achievement_list WHERE name_id = $1 FETCH FIRST 1 ROWS ONLY);

--GET_PLAYER_ACHIEVEMENTS_SQL
SELECT achievement_list.name from player_achievements INNER JOIN achievement_list ON player_achievements.achievement_id = achievement_list.id WHERE player_achievements.player_id = $1;
