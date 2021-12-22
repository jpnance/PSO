owners=("Keyon:162.60,26.53" "Schex:160.29,25.66" "Jason:154.95,28.83" "James/Charles:161.18,21.56")

for i in $(seq 0 $((${#owners[@]} - 1))); do
	for j in $(seq $i $((${#owners[@]} - 1))); do
		if (( $i != $j )); then
			node matchup.js n=10000 owners="${owners[$i]};${owners[$j]}"
			echo
		fi
	done
done
