#!/bin/bash

owners=("Quinn:160.77,25.84" "Schexes:155.61,21.07" "Koci/Mueller:156.05,22.33" "Jason:144.13,28.22")

for i in $(seq 0 $((${#owners[@]} - 1))); do
	for j in $(seq $i $((${#owners[@]} - 1))); do
		if (( $i != $j )); then
			node matchup.js n=100000 owners="${owners[$i]};${owners[$j]}"
			echo
		fi
	done
done
