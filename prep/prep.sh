#!/bin/sh

buffer=""
double_buffer=$(node overview.js $PANE_OPTIONS 2> /dev/null)

clear
echo $PANE_OPTIONS
echo -n "$double_buffer"

while true
do
	if [[ $buffer != $double_buffer ]]; then
		clear
		buffer=$double_buffer
		echo $PANE_OPTIONS
		echo -n "$buffer"
	fi

	sleep $((30 + $((RANDOM % 10))))

	double_buffer=$(node overview.js $PANE_OPTIONS 2> /dev/null)
done
