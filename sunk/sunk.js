$(document).ready(function() {
	computeSunkCosts();
	$("#salary").keyup(computeSunkCosts);
});

function formatMoney(n) {
	return '$' + n.toLocaleString('en-US');
}

function computeSunkCosts() {
	var salary = parseInt($("#salary").val());

	if (salary != "" && !isNaN(salary)) {
		$("#yearOneSunk").html(formatMoney(Math.ceil(salary * 0.6)));
		$("#yearTwoSunk").html(formatMoney(Math.ceil(salary * 0.3)));
		$("#yearThreeSunk").html(formatMoney(Math.ceil(salary * 0.15)));
	}
	else {
		$("#yearOneSunk").html("?");
		$("#yearTwoSunk").html("?");
		$("#yearThreeSunk").html("?");
	}

}
