owners=("Patrick:150.13,27.23" "John/Zach:159.10,24.25" "Keyon:167.43,19.49" "Trevor:141.74,27.88")

for i in $(seq 0 $((${#owners[@]} - 1))); do
	for j in $(seq $i $((${#owners[@]} - 1))); do
		if (( $i != $j )); then
			node matchup.js n=10000 owners="${owners[$i]};${owners[$j]}"
			echo
		fi
	done
done
