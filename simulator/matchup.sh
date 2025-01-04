#!/bin/bash

owners=("Keyon:165.61,22.48" "Schexes:157.33,17.69" "Luke:148.32,23.75" "Koci/Mueller:157.12,39.10")

for i in $(seq 0 $((${#owners[@]} - 1))); do
	for j in $(seq $i $((${#owners[@]} - 1))); do
		if (( $i != $j )); then
			node matchup.js n=100000 owners="${owners[$i]};${owners[$j]}"
			echo
		fi
	done
done
