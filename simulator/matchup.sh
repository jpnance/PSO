#!/bin/bash

owners=("Keyon:163.55,21.74" "Schexes:156.24,17.75" "Luke:146.92,23.87" "Koci/Mueller:157.92,40.34")

for i in $(seq 0 $((${#owners[@]} - 1))); do
	for j in $(seq $i $((${#owners[@]} - 1))); do
		if (( $i != $j )); then
			node matchup.js n=100000 owners="${owners[$i]};${owners[$j]}"
			echo
		fi
	done
done
