if [ -z "$1" ] || [ -z "$2" ]
then
	echo "Usage: bash $0 <franchise name> <from week>"
	exit 1
fi

winners=""

for week in $(seq $2 14)
do
	winners="$winners$week:$1"

	if [ "$week" -ne 14 ]
	then
		winners="$winners;"
	fi
done

node index.js n=10000 winners=$winners
