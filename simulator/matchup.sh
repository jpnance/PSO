owners=("Koci/Mueller:152.12,25.72" "Justin:142.62,16.15" "Mike:143.73,21.16" "Mitch:144.03,22.76")

for i in $(seq 0 $((${#owners[@]} - 1))); do
	for j in $(seq $i $((${#owners[@]} - 1))); do
		if (( $i != $j )); then
			node matchup.js n=100000 owners="${owners[$i]};${owners[$j]}"
			echo
		fi
	done
done
