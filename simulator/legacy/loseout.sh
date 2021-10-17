if [ -z "$1" ] || [ -z "$2" ]
then
	echo "Usage: bash $0 <franchise name> <from week>"
	exit 1
fi

losers=""

for week in $(seq $2 14)
do
	losers="$losers$week:$1"

	if [ "$week" -ne 14 ]
	then
		losers="$losers;"
	fi
done

node index.js n=10000 losers=$losers
