$(document).ready(function() {
	computeSunkCosts();
	$("#salary").keyup(computeSunkCosts);
});

function computeSunkCosts() {
	var salary = parseInt($("#salary").val());

	if (salary != "" && !isNaN(salary)) {
		$("#yearOneSunk").html("$" + Math.ceil(salary * 0.6));
		$("#yearTwoSunk").html("$" + Math.ceil(salary * 0.3));
		$("#yearThreeSunk").html("$" + Math.ceil(salary * 0.15));
	}
	else {
		$("#yearOneSunk").html("?");
		$("#yearTwoSunk").html("?");
		$("#yearThreeSunk").html("?");
	}

}
