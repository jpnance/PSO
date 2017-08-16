<?php
	header("Content-type: text/xml"); 
	header("Cache-Control: no-store, no-cache, must-revalidate");
	header("Pragma: no-cache");
	header("Expires: now");

	echo '<?xml version="1.0" encoding="ISO-8859-1"?>';
?>

<league>
	<season>2016</season>
	<drafted>
<?php
	/*
	$resultsUrl = "http://spreadsheets.google.com/feeds/list/0ArIlEyPlzLNIdFJHaVplX2ZMTVE5NnZ2dVJSeVY0d2c/2/public/basic";
	$cutsUrl = "http://spreadsheets.google.com/feeds/list/0ArIlEyPlzLNIdFJHaVplX2ZMTVE5NnZ2dVJSeVY0d2c/4/public/basic";
	*/

	$resultsUrl = "https://spreadsheets.google.com/feeds/list/1nas3AqWZtCu_UZIV77Jgxd9oriF1NQjzSjFWW86eong/2/public/basic";
	$cutsUrl = "https://spreadsheets.google.com/feeds/list/1nas3AqWZtCu_UZIV77Jgxd9oriF1NQjzSjFWW86eong/4/public/basic";

	$xmlParser = xml_parser_create();

	xml_set_element_handler($xmlParser, "startTag", "endTag");
	xml_set_character_data_handler($xmlParser, "contents");

	$resultsData = file_get_contents($resultsUrl);
	$cutsData = file_get_contents($cutsUrl);

	if (!(xml_parse($xmlParser, $resultsData))) {
		die("Error on line: " . xml_get_current_line_number($xmlParser));
	}

	xml_parser_free($xmlParser);


	$contentState = false;

	function startTag($parser, $data) {
		global $contentState, $entryState, $idState;

		switch($data) {
			case "CONTENT":
				$contentState = true;
				break;

			case "ENTRY":
				$entryState = true;
				break;

			case "TITLE":
				if ($entryState) {
					$idState = true;
				}
				break;
		}
	}

	function endTag($parser, $data) {
		global $contentState, $entryState, $idState;

		switch($data) {
			case "CONTENT":
				$contentState = false;
				break;

			case "ENTRY":
				$entryState = false;
				break;

			case "TITLE":
				if ($entryState) {
					$idState = false;
				}
				break;
		}
	}

	function contents($parser, $data) {
		global $contentState, $entryState, $idState;

		if ($idState) {
			$playerId = $data;
?>
		<player>
			<id><?= $playerId ?></id>
<?php
		}

		if ($contentState) {
			$playerFields = preg_split("/, /", $data);

			$playerName = "";
			$playerPosition = "";
			$playerStart = "";
			$playerEnd = "";
			$playerSalary = "";

			foreach ($playerFields as $playerField) {
				$playerPair = preg_split("/: /", $playerField);

				$name = $playerPair[0];
				$value = $playerPair[1];

				switch($name) {
				case "name":
					$playerName = $value;
					break;

				case "position":
					$playerPosition = $value;
					break;

				case "start":
					$playerStart = $value;
					break;

				case "end":
					$playerEnd = $value;
					break;

				case "salary":
					$playerSalary = str_replace("$", "", $value);
					break;
				}
			}

			if ($playerSalary == "") {
				$playerSalary = 0;
			}

			if ($playerEnd == "") {
				$playerEnd = "Not Yet Signed";
			}
?>
			<name><?= $playerName ?></name>
			<position><?= $playerPosition ?></position>
			<contract>
				<salary><?= $playerSalary ?></salary>
				<start><?= $playerStart ?></start>
				<end><?= $playerEnd ?></end>
			</contract>
		</player>
<?php

		}
	}

?>
	</drafted>
</league>
