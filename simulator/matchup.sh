#!/bin/bash

owners=("Quinn:160.00,25.15" "Schexes:154.90,20.55" "Koci/Mueller:159.30,25.19" "Jason:145.09,27.53")

for i in $(seq 0 $((${#owners[@]} - 1))); do
	for j in $(seq $i $((${#owners[@]} - 1))); do
		if (( $i != $j )); then
			node matchup.js n=100000 owners="${owners[$i]};${owners[$j]}"
			echo
		fi
	done
done
