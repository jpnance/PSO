owners=("Luke:153.03,16.60" "Keyon:149.23,24.04" "Jason:155.88,17.72" "Mitch/Mike:160.49,23.28")

for i in $(seq 0 $((${#owners[@]} - 1))); do
	for j in $(seq $i $((${#owners[@]} - 1))); do
		if (( $i != $j )); then
			node matchup.js n=100000 owners="${owners[$i]};${owners[$j]}"
			echo
		fi
	done
done
