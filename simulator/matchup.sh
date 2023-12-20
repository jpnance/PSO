owners=("Koci/Mueller:151.25,26.38" "Justin:143.47,16.34" "Mike:143.18,21.79" "Mitch:144.23,23.54")

for i in $(seq 0 $((${#owners[@]} - 1))); do
	for j in $(seq $i $((${#owners[@]} - 1))); do
		if (( $i != $j )); then
			node matchup.js n=100000 owners="${owners[$i]};${owners[$j]}"
			echo
		fi
	done
done
