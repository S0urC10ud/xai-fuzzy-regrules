const worker = new Worker("./analysisWorker.js");

worker.onerror = function (event) {
  console.error("Error in worker: ", event);
  window.specialEvent = event;
  setTimeout(() => {
    $("#loadingModal").modal("hide"); //again delayed (might be needed)
  }, 200);
};

worker.onmessageerror = function (event) {
  console.error("Error in worker message: ", event);
  window.specialEvent = event;
  setTimeout(() => {
    $("#loadingModal").modal("hide"); //again delayed (might be needed)
  }, 200);
};

worker.onmessage = function (event) {
  const { success, data, error } = event.data;
  $("#loadingModal").modal("hide");

  if (success) {
    console.log("Analysis completed");
    runButton.classList.remove("pulsing-button");
    document.getElementById("choice-container").style.display = "none";
    document.getElementById("main-content-container").style.display = "grid";

    visualizeTable(data);

    setTimeout(() => {
      $("#loadingModal").modal("hide"); //again delayed (might be needed)
    }, 200);
  } else {
    alert("Error running analysis: " + error);
    setTimeout(() => {
      $("#loadingModal").modal("hide"); //again delayed (might be needed)
    }, 200);
  }
};

document
  .getElementById("downloadJsonButton")
  .addEventListener("click", function () {
    const dataStr =
      "data:text/json;charset=utf-8," +
      encodeURIComponent(JSON.stringify(window.rulesData));
    const downloadAnchorNode = document.createElement("a");
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "rulesData.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  });

function addHoverSpans(ruleText) {
  const regex = /If (.*?)(?= AND| then)|then (.*)/g;
  return ruleText.replace(regex, function (match, p1, p2) {
    const content = p1 || p2;
    const role = p1 ? "antecedent" : "consequent";
    return match.replace(
      content,
      `<span class="hover-item" data-role="${role}">${content}</span>`
    );
  });
}

function visualizeTable(rulesData) {
  window.rulesData = rulesData;
  document.getElementById("downloadJsonButton").style.display = "inline-block";

  // Determine if "Secondary Rules" and "P-Value" columns should be displayed
  const hasSecondaryRules = rulesData.sorted_rules.some(
    (rule) => rule.secondaryRules && rule.secondaryRules.length > 0
  );
  const hasPValue = rulesData.sorted_rules.some(
    (rule) => !isNaN(rule.pValue) && rule.pValue !== null
  );
  const columnNamesSet = new Set();
  rulesData.sorted_rules.forEach((rule) => {
    const columnsInRule = extractColumnNames(rule.title);
    columnsInRule.forEach((col) => columnNamesSet.add(col));
  });
  const columnNames = Array.from(columnNamesSet);

  // Assign unique colors to each column name
  const colors = generateRainbowColors(columnNames.length);
  const columnColorMap = {};
  columnNames.forEach((colName, index) => {
    columnColorMap[colName] = colors[index];
  });

  // Define columns with tooltips
  let columns = [
    {
      data: "title",
      title: "Rule",
      width: "min(25rem,30vw)",
      render: function (data, type, row) {
        const ruleWithSpans = addHoverSpans(row.title);
        const coloredRule = colorColumnNames(ruleWithSpans, columnColorMap);
        return coloredRule;
      },
    },
    {
      data: null,
      title: "Trend <span class='custom-tooltip'>?\
        <span class='custom-tooltiptext'>Visualizes the consequent of the rule.</span>\
      </span>",
      width: "4rem",
      render: function (data, type, row) {
        const lastWord = row.title.trim().split(" ").pop().toLowerCase();
        let emoji = "";
        switch (lastWord) {
          case "verylow":
            emoji = "<span style='color:red;'>&#8595;</span>"; // Red down arrow
            break;
          case "low":
            emoji = "<span style='color:orange;'>&#8595;</span>"; // Orange down arrow
            break;
          case "mediumlow":
            emoji = "<span style='color:yellow;'>&#8595;</span>"; // Yellow down arrow
            break;
          case "medium":
            emoji = "<span style='color:gray;'>&#8594;</span>"; // Gray right arrow
            break;
          case "high":
            emoji = "<span style='color:orange;'>&#8593;</span>"; // Orange up arrow
            break;
          case "veryhigh":
            emoji = "<span style='color:red;'>&#8593;</span>"; // Red up arrow
            break;
          default:
            emoji = "";
        }
        return emoji;
      },
    },
    {
      data: "coefficient",
      title:
        "Coefficient <span class='custom-tooltip'>?\
        <span class='custom-tooltiptext'>Linear regression coefficient of this basis function.</span>\
      </span>",
      render: function (data) {
        return parseFloat(data).toFixed(6);
      },
    },
    {
      data: "pValue",
      title:
        "P-Value <span class='custom-tooltip'>?\
        <span class='custom-tooltiptext'>Statistical significance of the rule.</span>\
      </span>",
      render: function (data) {
        return isNaN(data) ? "N/A" : parseFloat(data).toFixed(6);
      },
    },
    {
      data: "priority",
      title:
        "Priority <span class='custom-tooltip'>?\
        <span class='custom-tooltiptext'>Computed priority (as specified by the config)</span>\
      </span>",
      render: function (data) {
        return parseFloat(data).toFixed(6);
      },
    },
    {
      data: "support",
      title:
        "Support <span class='custom-tooltip'>?\
        <span class='custom-tooltiptext'>Fraction of instances where this rule holds.</span>\
      </span>",
      render: function (data) {
        return parseFloat(data).toFixed(6);
      },
    },
    {
      data: "leverage",
      title:
        "Leverage <span class='custom-tooltip'>?\
        <span class='custom-tooltiptext'>Rule-Mining leverage value indicating the influence of the rule.</span>\
      </span>",
      render: function (data) {
        return parseFloat(data).toFixed(6);
      },
    },
    {
      data: "mostContributingCSVRows",
      title:
        "Most Affected Rows <span class='custom-tooltip'>?\
        <span class='custom-tooltiptext'>CSV rows (represents line number - starting with 1) where this rule holds with the highest leverage.</span>\
      </span>",
      render: function (data) {
        return data.join(", ");
      },
    }
  ];

  if (hasSecondaryRules) {
    columns.push({
      data: "secondaryRules",
      title:
        "Secondary Rules <span class='custom-tooltip'>?\
        <span class='custom-tooltiptext'>Additional related rules.</span>\
      </span>",
      render: function (data) {
        return data.join(", ");
      },
    });
  }

  if (!hasPValue)
    columns = columns.filter((col) => col.data !="pValue");


  let thead = "<thead><tr>";
  columns.forEach(function (column) {
    thead += `<th>${column.title}</th>`;
  });
  thead += "</tr></thead>";
  $("#rulesTable").html(thead);
  $("#rulesTable").DataTable().destroy();
  $("#rulesTable").DataTable({
    data: rulesData.sorted_rules,
    columns: columns,
    order: [[2, "desc"]],
    responsive: false,
    autoWidth: false,
    searching: true,
    paging: true,
    ordering: true,
    pageLength: 10,
    columnDefs: [
      {
        targets: 0,
        width: "20rem",
        className: "rule-title-column",
      },
    ],
    initComplete: function () {
      $("#rulesTable").colResizable({
        liveDrag: true,
        resizeMode: "fit",
        minWidth: 50,
        gripInnerHtml: "<div class='grip'></div>",
        draggingClass: "dragging",
        hoverClass: "hover",
      });
      const tooltips = document.querySelectorAll(".custom-tooltip");
      tooltips.forEach(function (tooltip) {
        const tooltipText = tooltip.querySelector(".custom-tooltiptext");
        tooltip.addEventListener("mouseenter", function () {
          tooltipText.style.opacity = "1";
          tooltipText.style.visibility = "visible";
        });
        tooltip.addEventListener("mouseleave", function () {
          tooltipText.style.opacity = "0";
          tooltipText.style.visibility = "hidden";
        });
      });
    },
  });

  const mean_absolute_error = rulesData.mean_absolute_error;
  const root_mean_squared_error = rulesData.root_mean_squared_error;
  const r_squared = rulesData.r_squared;
  const mean_absolute_percentage_error =
    rulesData.mean_absolute_percentage_error;

  const qualityMetrics = [
    { name: "Mean Absolute Error", value: mean_absolute_error.toFixed(4) },
    {
      name: "Root Mean Squared Error",
      value: root_mean_squared_error.toFixed(4),
    },
    { name: "R²", value: r_squared.toFixed(4) },
    {
      name: "Mean Absolute Percentage Error",
      value: mean_absolute_percentage_error.toFixed(4),
    },
  ];

  let qualityHtml = "<table>";
  qualityHtml += "<tr><th>Metric</th><th>Value</th></tr>";
  qualityMetrics.forEach((metric) => {
    qualityHtml += `<tr><td>${metric.name}</td><td>${metric.value}</td></tr>`;
  });
  qualityHtml += "</table>";
  document.getElementById("qualityOfFit").innerHTML = qualityHtml;
  const warnings = rulesData.warnings; // Adjust based on JSON structure
  let warningsHtml = "<ul>";
  warnings.forEach((warning) => {
    if (Array.isArray(warning) && warning.length === 0) {
      return;
    }
    // Serialize warning if it's an object, otherwise convert it to a string
    const warningText =
      typeof warning === "object"
        ? JSON.stringify(warning)
        : warning.toString();
    warningsHtml += `<li>${warningText}</li>`;
  });
  warningsHtml += "</ul>";
  document.getElementById("warnings").innerHTML = warningsHtml;
  function extractColumnNames(ruleText) {
    const columnNames = [];
    const regex = /If ([^ ]+)/g;
    let match;
    while ((match = regex.exec(ruleText)) !== null) {
      columnNames.push(match[1]);
    }
    return columnNames;
  }
  function generateRainbowColors(numColors) {
    const colors = [];
    for (let i = 0; i < numColors; i++) {
      const hue = (i * 360) / numColors;
      colors.push(`hsl(${hue}, 80%, 50%)`);
    }
    return colors;
  }
  function colorColumnNames(ruleText, colorMap) {
    let coloredText = ruleText;
    Object.keys(colorMap).forEach((colName) => {
      const color = colorMap[colName];
      const regex = new RegExp(`\\b${colName}\\b`, "g");
      coloredText = coloredText.replace(
        regex,
        `<span style="color:${color}">${colName}</span>`
      );
    });
    return coloredText;
  }
}

function toggleRightPane() {
  var rightPane = document.querySelector(".right-pane");
  var toggleButton = document.querySelector(".collapsible");

  if (rightPane.style.display === "none" || rightPane.style.display === "") {
    rightPane.style.display = "block";
  } else {
    rightPane.style.display = "none";
  }
  toggleButton.classList.add("click-animation");
  setTimeout(function () {
    toggleButton.classList.remove("click-animation");
  }, 300); // Duration of the animation
}

function handleResize() {
  var rightPane = document.querySelector(".right-pane");
  if (window.innerWidth > 768) {
    rightPane.style.display = "block";
  }
}

window.addEventListener("resize", handleResize);
window.addEventListener("load", handleResize);

const mainContainer = document.getElementById("mainContainer");

document.addEventListener("DOMContentLoaded", function () {
  const removeLowVarianceCheckbox = document.getElementById(
    "remove_low_variance"
  );
  const varianceThresholdField = document.getElementById("variance_threshold");

  if (removeLowVarianceCheckbox && varianceThresholdField) {
    const toggleVarianceThreshold = () => {
      varianceThresholdField.disabled = !removeLowVarianceCheckbox.checked;
    };

    removeLowVarianceCheckbox.addEventListener(
      "change",
      toggleVarianceThreshold
    );
    toggleVarianceThreshold();
  }

  const rulePriorityEnabledCheckbox = document.getElementById(
    "rule_priority_enabled"
  );
  const minPriorityField = document.getElementById("min_priority");

  if (rulePriorityEnabledCheckbox && minPriorityField) {
    const toggleRulePriority = () => {
      minPriorityField.disabled = !rulePriorityEnabledCheckbox.checked;
    };

    rulePriorityEnabledCheckbox.addEventListener("change", toggleRulePriority);
    toggleRulePriority();
  }
});

document.addEventListener("DOMContentLoaded", function () {
  const container = document.getElementById("outlier-filters-container");
  const addButton = document.getElementById("add-outlier-filter");

  addButton.addEventListener("click", () => {
    const fieldset = document.createElement("fieldset");
    fieldset.className = "nested-fieldset";
    fieldset.innerHTML = `
        <legend>New Column</legend>
        <div class="config-row">
            <div class="config-item">
                <label>Column Name
                    <span class="custom-tooltip">?<span class="custom-tooltiptext">Name of the csv-column for outlier filtering</span></span>
                </label>
                <input type="text" class="column-name" name="outlier_new_column" placeholder="Enter column name">
            </div>
            <div class="config-item">
                <label>Method
                    <span class="custom-tooltip">?<span class="custom-tooltiptext">Filtering strategy</span></span>
                </label>
                <select class="outlier-method" name="outlier_method">
                    <option value="VariableBounds">Variable Bounds</option>
                    <option value="IQR">IQR</option>
                </select>
            </div>
            
            <div class="config-item method-inputs">
                <label>Min</label>
                <input type="number" name="outlier_min" value="0">
            </div>
            
            <div class="config-item method-inputs">
                <label>Max</label>
                <input type="number" name="outlier_max" value="100">
            </div>
            
            <div class="config-item method-inputs" style="display:none;">
                <label>IQR Multiplier</label>
                <input type="number" step="0.1" name="outlier_iqr_multiplier" value="1.5">
            </div>
        </div>
        <button type="button" class="delete-filter btn btn-danger btn-sm">🗑️</button>
    `;
    container.appendChild(fieldset);
    const columnNameInput = fieldset.querySelector(".column-name");
    const legend = fieldset.querySelector("legend");

    columnNameInput.addEventListener("input", async () => {
      const value = columnNameInput.value.trim();
      legend.textContent = value ? value : "New Column";
      if (window.uploadedFile && value) {
        try {
          const data = await parseCSV(window.uploadedFile);
          if (data && data[value]) {
            displayBoxPlot(data[value], fieldset, value);
          } else {
            console.warn(
              `Column "${value}" not found in the uploaded CSV file.`
            );
          }
        } catch (error) {
          console.error("Error parsing CSV:", error);
        }
      }
    });
  });
  container.addEventListener("change", function (e) {
    if (e.target.classList.contains("outlier-method")) {
      const method = e.target.value;
      const inputs = e.target
        .closest(".config-row")
        .querySelectorAll(".method-inputs");
      inputs.forEach((input) => {
        if (method === "VariableBounds") {
          if (
            input.querySelector("label").textContent.includes("Min") ||
            input.querySelector("label").textContent.includes("Max")
          ) {
            input.style.display = "block";
          } else {
            input.style.display = "none";
          }
        } else if (method === "IQR") {
          if (
            input.querySelector("label").textContent.includes("IQR Multiplier")
          ) {
            input.style.display = "block";
          } else {
            input.style.display = "none";
          }
        }
      });
    }
  });

  container.addEventListener("click", function (e) {
    if (e.target.classList.contains("delete-filter")) {
      e.target.closest("fieldset").remove();
    }
  });
});
async function parseCSV(csvString) {
  return new Promise((resolve, reject) => {
    Papa.parse(csvString, {
      header: true,
      dynamicTyping: true,
      complete: function (results) {
        // Transform data into a column-based format
        const columns = {};
        results.meta.fields.forEach((field) => {
          columns[field] = results.data
            .map((row) => row[field])
            .filter((val) => val != null && val !== "");
        });
        resolve(columns);
      },
      error: function (err) {
        reject(err);
      },
    });
  });
}

function displayBoxPlot(columnData, container, columnName) {
  const existingCanvas = container.querySelector(".boxplot-canvas");
  if (existingCanvas) {
    existingCanvas.remove();
  }
  const canvas = document.createElement("canvas");
  canvas.className = "boxplot-canvas";
  canvas.style.width = "100%";
  container.appendChild(canvas);
  container.style.position = "relative";
  new Chart(canvas.getContext("2d"), {
    type: "boxplot",
    data: {
      labels: [columnName],
      datasets: [
        {
          label: columnName,
          data: [columnData],
          backgroundColor: "rgba(255, 204, 0, 0.5)",
          borderColor: "rgba(255, 204, 0, 1)",
          borderWidth: 1,
        },
      ],
    },
    options: {
      indexAxis: "y", // Make the box plot horizontal
      responsive: false,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          enabled: true,
        },
      },
      scales: {
        x: {
          display: true,
          title: {
            display: true,
            text: columnName,
          },
        },
        y: {
          display: true,
        },
      },
    },
  });
}

document.querySelectorAll(".option-to-choose").forEach((option) => {
  option.addEventListener("click", async function () {
    const optionText = this.querySelector("p").innerText;
    if (optionText === "Try out a demo dataset with its default config") {
      try {
        $("#downloadModal").modal("show");
      } catch (error) {
        console.error("Error fetching JSON:", error);
      }
    }
  });
});

document
  .getElementById("downloadButton")
  .addEventListener("click", function () {
    const link = document.createElement("a");
    link.href =
      "https://github.com/S0urC10ud/xai-fuzzy-regrules/tree/main/example_unveiling_biases/biased_salaries";
    link.target = "_blank";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    $("#downloadModal").modal("hide");
  });

$("#downloadModal").on("hidden.bs.modal", async function () {
  const response = await fetch("assets/demo_configuration.json");
  if (!response.ok) {
    throw new Error("Failed to fetch demo configuration");
  }
  const config = await response.json();

  // Map JSON fields to form inputs
  document.getElementById("split_char").value = config.split_char ?? ";";
  document.getElementById("target_var").value = config.target_var ?? "MEDV";
  document.getElementById("num_vars").value = config.num_vars ?? 2;
  document.getElementById("include_intercept").checked =
    config.include_intercept ?? true;
  document.getElementById("compute_pvalues").checked =
    config.compute_pvalues ?? false;
  document.getElementById("numerical_fuzzification").value =
    config.numerical_fuzzification.length ?? 5;
  document.getElementById("numerical_defuzzification").value =
    config.numerical_defuzzification.length ?? 5;
  document.getElementById("whitelist").value =
    config.whitelist.join("\n") ?? "";
  document.getElementById("blacklist").value =
    config.blacklist.join("\n") ?? "";

  // Rule Filters
  document.getElementById("l1_row_threshold").value =
    config.rule_filters.l1_row_threshold ?? 0.1;
  document.getElementById("l1_column_threshold").value =
    config.rule_filters.l1_column_threshold ?? 0.1;
  document.getElementById("dependency_threshold").value =
    config.rule_filters.dependency_threshold ?? 0.02;
  document.getElementById("significance_level").value =
    config.rule_filters.significance_level ?? 0.05;
  document.getElementById("remove_insignificant_rules").checked =
    config.rule_filters.remove_insignificant_rules ?? false;
  document.getElementById("only_whitelist").checked =
    config.rule_filters.only_whitelist ?? false;

  // Rule Priority Filtering
  document.getElementById("rule_priority_enabled").checked =
    config.rule_filters.rule_priority_filtering.enabled ?? false;
  document.getElementById("min_priority").value =
    config.rule_filters.rule_priority_filtering.min_priority ?? 10;

  // Rule Priority Weights
  document.getElementById("support_weight").value =
    config.rule_priority_weights.support_weight ?? 1;
  document.getElementById("leverage_weight").value =
    config.rule_priority_weights.leverage_weight ?? 10;
  document.getElementById("num_antecedents_weight").value =
    config.rule_priority_weights.num_antecedents_weight ?? 1;
  document.getElementById("whitelist_boolean_weight").value =
    config.rule_priority_weights.whitelist_boolean_weight ?? 1000;

  // Lasso Configuration
  document.getElementById("lasso_regularization").value =
    config.lasso.regularization ?? 0.00001;
  document.getElementById("max_lasso_iterations").value =
    config.lasso.max_lasso_iterations ?? 10000;
  document.getElementById("lasso_convergence_tolerance").value =
    config.lasso.lasso_convergence_tolerance ?? 0.0001;

  // Variance Threshold
  document.getElementById("remove_low_variance").checked =
    config.remove_low_variance ?? false;
  document.getElementById("variance_threshold").value =
    config.variance_threshold ?? 0.00001;

  const outlierFilters = config.outlier_filtering;
  if (outlierFilters && Object.keys(outlierFilters).length > 0) {
    const container = document.getElementById("outlier-filters-container");
    const addButton = document.getElementById("add-outlier-filter");

    Object.entries(outlierFilters).forEach(([columnName, filterConfig]) => {
      addButton.click();

      const fieldsets = container.querySelectorAll("fieldset");
      const lastFieldset = fieldsets[fieldsets.length - 1];

      const columnNameInput = lastFieldset.querySelector(".column-name");
      columnNameInput.value = columnName;

      const legend = lastFieldset.querySelector("legend");
      legend.textContent = columnName;

      const methodSelect = lastFieldset.querySelector(".outlier-method");
      methodSelect.value = filterConfig.method;

      methodSelect.dispatchEvent(new Event("change"));

      if (filterConfig.method === "VariableBounds") {
        const minInput = lastFieldset.querySelector(
          'input[name="outlier_min"]'
        );
        const maxInput = lastFieldset.querySelector(
          'input[name="outlier_max"]'
        );
        minInput.value = filterConfig.min;
        maxInput.value = filterConfig.max;
      } else if (filterConfig.method === "IQR") {
        const iqrInput = lastFieldset.querySelector(
          'input[name="outlier_iqr_multiplier"]'
        );
        iqrInput.value = filterConfig.outlier_iqr_multiplier || 1.5;
      }
    });
  }

  console.log("Configuration pane updated with demo configuration.");
  document.getElementById("choice-container").style.display = "none";
  document.getElementById("main-content-container").style.display = "grid";

  const rulesResponse = await fetch("assets/biased_salaries.json");
  if (!rulesResponse.ok) {
    throw new Error("Failed to fetch biased salaries data");
  }
  const rulesData = await rulesResponse.json();
  const csvResponse = await fetch("assets/biased_salaries.csv");
  if (!csvResponse.ok) {
    throw new Error("Failed to fetch biased salaries CSV data");
  }
  const csvText = await csvResponse.text();

  const data = await parseCSV(csvText);

  const filteredData = applyOutlierFiltering(data);

  window.variableBounds = {};
  Object.keys(filteredData).forEach((variable) => {
    const values = filteredData[variable]
      .map((val) => parseFloat(val))
      .filter((val) => !isNaN(val));
    const min = Math.min(...values);
    const max = Math.max(...values);
    window.variableBounds[variable] = { min, max };
  });

  visualizeTable(rulesData);
});

function computeMembershipDegrees(x, min, max, classes) {
  const allowedClasses = [
    "verylow",
    "low",
    "mediumlow",
    "medium",
    "mediumhigh",
    "high",
    "veryhigh",
  ];

  const sortedClasses = classes
    .filter((cls) => allowedClasses.includes(cls))
    .sort((a, b) => allowedClasses.indexOf(a) - allowedClasses.indexOf(b));

  if (classes.filter((cls) => !allowedClasses.includes(cls)).length > 0) {
    throw new Error(
      "Invalid (de-)fuzzification classes provided. Valid classes are: verylow, low, mediumlow, medium, mediumhigh, high, veryhigh."
    );
  }

  const numClasses = sortedClasses.length;
  if (![3, 5, 6, 7].includes(numClasses)) {
    throw new Error("Number of classes must be either 3, 5, 6, or 7.");
  }

  const range = max - min;
  const step = range / (numClasses - 1);

  const peaks = Array.from({ length: numClasses }, (_, i) => min + i * step);

  const triangles = peaks.map((peak, i) => {
    const left = i === 0 ? min : peaks[i - 1];
    const right = i === numClasses - 1 ? max : peaks[i + 1];
    return { left, peak, right };
  });

  const triangle = (x, left, peak, right) => {
    if (x === peak) return 1;
    if (x < left || x > right) return 0;
    if (x < peak) {
      return (x - left) / (peak - left);
    } else {
      return (right - x) / (right - peak);
    }
  };

  // Compute raw membership degrees
  const rawDegrees = triangles.map(({ left, peak, right }) =>
    triangle(x, left, peak, right)
  );

  // Ensure first and last class peak at min and max
  rawDegrees[0] = x <= min ? 1 : rawDegrees[0];
  rawDegrees[numClasses - 1] = x >= max ? 1 : rawDegrees[numClasses - 1];

  // Normalize the degrees so that their sum is 1
  const sumDegrees = rawDegrees.reduce((sum, degree) => sum + degree, 0);
  const normalizedDegrees =
    sumDegrees === 0
      ? rawDegrees.map(() => 0)
      : rawDegrees.map((degree) => degree / sumDegrees);

  const membershipDegrees = {};
  sortedClasses.forEach((cls, idx) => {
    membershipDegrees[cls] = parseFloat(normalizedDegrees[idx].toFixed(4)); // Rounded for readability
  });

  return membershipDegrees;
}

function extractVariableAndFuzzySet(element) {
  const text = $(element).text();
  const parts = text.split(" is ");
  return {
    variable: parts[0].trim().replace("If ", ""),
    fuzzySet: parts[1].trim(),
    role: $(element).data("role") || "antecedent",
  };
}

function getFuzzySets() {
  return getNumericalFuzzification();
}

function getVariableBounds(variable) {
  return window.variableBounds[variable];
}

function generateFuzzificationData(min, max, classes) {
  const data = [];
  const step = (max - min) / 100;
  for (let x = min; x <= max; x += step) {
    const degrees = computeMembershipDegrees(x, min, max, classes);
    data.push({ x, degrees });
  }
  return data;
}

function createFuzzificationChart(
  ctx,
  chartData,
  highlightSet,
  variable,
  role
) {
  const datasets = [];
  let i = 0;
  for (const cls of Object.keys(chartData[0].degrees)) {
    datasets.push({
      label: cls,
      data: chartData.map((point) => ({ x: point.x, y: point.degrees[cls] })),
      borderColor: cls === highlightSet ? "red" : "gray",
      fill: false,
    });
    i++;
  }
  new Chart(ctx, {
    type: "line",
    data: { datasets },
    options: {
      scales: { x: { type: "linear" }, y: { max: 1, min: 0 } },
      plugins: {
        title: {
          display: true,
          text: `${variable}`,
          align: "center",
        },
      },
    },
  });
}

$(document).on("click", ".hover-item", function (event) {
  event.stopPropagation();
  const $this = $(this);

  if ($this.find(".tooltip-chart").length) {
    $this.find(".tooltip-chart").remove();
  } else {
    const { variable, fuzzySet, role } = extractVariableAndFuzzySet(this);
    const classes =
      role === "consequent"
        ? getNumericalDefuzzification()
        : getNumericalFuzzification();
    const bounds = getVariableBounds(variable);

    // Check if bounds are finite numbers - infinite for categorical data
    if (isFinite(bounds.min) && isFinite(bounds.max)) {
      const chartData = generateFuzzificationData(
        bounds.min,
        bounds.max,
        classes
      );

      const numFuzzySets = classes.length;

      // Adjust size based on numFuzzySets
      let width, height;
      if (numFuzzySets === 3) {
        width = 300;
        height = 200;
      } else if (numFuzzySets === 5) {
        width = 400;
        height = 250;
      } else if (numFuzzySets === 6) {
        width = 450;
        height = 275;
      } else if (numFuzzySets === 7) {
        width = 500;
        height = 300;
      } else {
        width = 300;
        height = 200;
      }


      $this.append(
        `<div class="tooltip-chart" style="width:${width}px; height:${height}px; position:absolute; z-index:1000;">
          <canvas width="${width}" height="${height}"></canvas>
        </div>`
      );

      const ctx = $this.find("canvas")[0].getContext("2d");
      createFuzzificationChart(ctx, chartData, fuzzySet, variable, role);
    }
  }
});

$(document).on("mouseleave", ".hover-item", function () {
  $(this).find(".tooltip-chart").remove();
});

const uploadButton1 = document.getElementById("uploadButton1");
const uploadButton2 = document.getElementById("uploadButton2");
const fileInput1 = document.getElementById("fileInput1");
const fileInput2 = document.getElementById("fileInput2");
const runButton = document.getElementById("runButton");

uploadButton1.addEventListener("click", () => {
  fileInput1.click();
});

uploadButton2.addEventListener("click", () => {
  fileInput1.click();
});
function applyOutlierFiltering(data) {
  const outlierFilters = getOutlierFiltering();

  // Create a copy of the data to avoid mutating the original
  let filteredData = {};
  const dataLength = data[Object.keys(data)[0]].length; // Assuming all columns have the same length

  Object.keys(data).forEach((key) => {
    filteredData[key] = [];
  });

  for (let i = 0; i < dataLength; i++) {
    let exclude = false;

    // Check each filter
    for (let [columnName, filterConfig] of Object.entries(outlierFilters)) {
      const value = parseFloat(data[columnName][i]);

      if (isNaN(value)) {
        exclude = true;
        break;
      }

      if (filterConfig.method === "VariableBounds") {
        const { min, max } = filterConfig;
        if (value < min || value > max) {
          exclude = true;
          break;
        }
      } else if (filterConfig.method === "IQR") {
        const columnData = data[columnName]
          .map((val) => parseFloat(val))
          .filter((val) => !isNaN(val));
        const multiplier = filterConfig.outlier_iqr_multiplier || 1.5;
        const sortedValues = columnData.sort((a, b) => a - b);
        const q1 = getPercentile(sortedValues, 25);
        const q3 = getPercentile(sortedValues, 75);
        const iqr = q3 - q1;
        const lowerBound = q1 - multiplier * iqr;
        const upperBound = q3 + multiplier * iqr;
        if (value < lowerBound || value > upperBound) {
          exclude = true;
          break;
        }
      }
    }

    if (!exclude) {
      Object.keys(data).forEach((key) => {
        filteredData[key].push(data[key][i]);
      });
    }
  }

  return filteredData;
}

function getPercentile(sortedArr, percentile) {
  const index = (percentile / 100) * (sortedArr.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index % 1;

  if (upper >= sortedArr.length) return sortedArr[lower];
  return sortedArr[lower] * (1 - weight) + sortedArr[upper] * weight;
}

function getOutlierFiltering() {
  const container = document.getElementById("outlier-filters-container");
  const filters = {};

  const fieldsets = container.querySelectorAll("fieldset");

  fieldsets.forEach((fieldset) => {
    const columnName = fieldset.querySelector(".column-name").value.trim();
    const method = fieldset.querySelector(".outlier-method").value;
    const filter = { method };

    if (method === "VariableBounds") {
      const min = parseFloat(
        fieldset.querySelector('input[name="outlier_min"]').value
      );
      const max = parseFloat(
        fieldset.querySelector('input[name="outlier_max"]').value
      );
      filter.min = min;
      filter.max = max;
    } else if (method === "IQR") {
      const multiplier = parseFloat(
        fieldset.querySelector('input[name="outlier_iqr_multiplier"]').value
      );
      filter.outlier_iqr_multiplier = multiplier;
    }

    if (columnName) {
      filters[columnName] = filter;
    }
  });

  return filters;
}
function handleFileUpload(fileInput, fileNumber) {
  const file = fileInput.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = async function (e) {
      window.uploadedFile = e.target.result;
      const data = await parseCSV(window.uploadedFile);
      const filteredData = applyOutlierFiltering(data);
      window.variableBounds = {};
      Object.keys(filteredData).forEach((variable) => {
        const values = filteredData[variable]
          .map((val) => parseFloat(val))
          .filter((val) => !isNaN(val));
        const min = Math.min(...values);
        const max = Math.max(...values);
        window.variableBounds[variable] = { min, max };
      });

      document.getElementById("runButton").disabled = false;
      document.getElementById("uploadButton1").textContent = "Uploaded File✔️";
      document.getElementById("uploadButton1").style.backgroundColor =
        "#ffcc00";
      document.getElementById("uploadButton1").style.color = "black";

      document.getElementById("uploadButton2").childNodes[1].textContent = "✔️";
      document.getElementById("uploadButton2").childNodes[3].textContent =
        "Successfully read the file! Now configure and run!";
      document.getElementById("uploadButton2").childNodes[3].style.color =
        "black";
      document.getElementById("uploadButton2").style.backgroundColor =
        "#ffcc00";

      runButton.classList.add("pulsing-button");

      // If viewport width is less than 768px, toggle the configuration pane
      const rightPane = document.querySelector(".right-pane");
      if (
        (window.innerWidth <= 768 && rightPane.style.display === "none") ||
        rightPane.style.display === ""
      ) {
        toggleRightPane();
      }
    };
    reader.readAsText(file);
  }
}

fileInput1.addEventListener("change", () => handleFileUpload(fileInput1, 1));

function getNumericalFuzzification() {
  const numSets = parseInt(
    document.getElementById("numerical_fuzzification").value,
    10
  );
  switch (numSets) {
    case 3:
      return ["low", "medium", "high"];
    case 5:
      return ["verylow", "low", "medium", "high", "veryhigh"];
    case 6:
      return ["verylow", "low", "mediumlow", "mediumhigh", "high", "veryhigh"];
    case 7:
      return [
        "verylow",
        "low",
        "mediumlow",
        "medium",
        "mediumhigh",
        "high",
        "veryhigh",
      ];
    default:
      return ["low", "medium", "high"];
  }
}

function getNumericalDefuzzification() {
  const numSets = parseInt(
    document.getElementById("numerical_defuzzification").value,
    10
  );
  switch (numSets) {
    case 3:
      return ["low", "medium", "high"];
    case 5:
      return ["verylow", "low", "medium", "high", "veryhigh"];
    case 6:
      return ["verylow", "low", "mediumlow", "mediumhigh", "high", "veryhigh"];
    case 7:
      return [
        "verylow",
        "low",
        "mediumlow",
        "medium",
        "mediumhigh",
        "high",
        "veryhigh",
      ];
    default:
      return ["low", "medium", "high"];
  }
}

function getOutlierFiltering() {
  const container = document.getElementById("outlier-filters-container");
  const filters = {};

  const fieldsets = container.querySelectorAll("fieldset");

  fieldsets.forEach((fieldset) => {
    const columnName = fieldset.querySelector(".column-name").value.trim();
    const method = fieldset.querySelector(".outlier-method").value;
    const filter = { method };

    if (method === "VariableBounds") {
      const min = parseFloat(
        fieldset.querySelector('input[name="outlier_min"]').value
      );
      const max = parseFloat(
        fieldset.querySelector('input[name="outlier_max"]').value
      );
      filter.min = min;
      filter.max = max;
    } else if (method === "IQR") {
      const multiplier = parseFloat(
        fieldset.querySelector('input[name="outlier_iqr_multiplier"]').value
      );
      filter.outlier_iqr_multiplier = multiplier;
    }

    if (columnName) {
      filters[columnName] = filter;
    }
  });

  return filters;
}

function getWhitelist() {
  const input = document.getElementById("whitelist").value;
  return input
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function getBlacklist() {
  const input = document.getElementById("blacklist").value;
  return input
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

document.getElementById("runButton")?.addEventListener("click", async () => {
  $("#loadingModal").modal("show");

  const config = {
    split_char: document.getElementById("split_char").value,
    target_var: document.getElementById("target_var").value,
    lasso: {
      regularization: parseFloat(
        document.getElementById("lasso_regularization").value
      ),
      max_lasso_iterations: parseInt(
        document.getElementById("max_lasso_iterations").value,
        10
      ),
      lasso_convergence_tolerance: parseFloat(
        document.getElementById("lasso_convergence_tolerance").value
      ),
    },
    rule_filters: {
      l1_row_threshold: parseFloat(
        document.getElementById("l1_row_threshold").value
      ),
      l1_column_threshold: parseFloat(
        document.getElementById("l1_column_threshold").value
      ),
      dependency_threshold: parseFloat(
        document.getElementById("dependency_threshold").value
      ),
      significance_level: parseFloat(
        document.getElementById("significance_level").value
      ),
      remove_insignificant_rules: document.getElementById(
        "remove_insignificant_rules"
      ).checked,
      only_whitelist: document.getElementById("only_whitelist").checked,
      rule_priority_filtering: {
        enabled: document.getElementById("rule_priority_enabled").checked,
        min_priority: parseFloat(document.getElementById("min_priority").value),
      },
    },
    numerical_fuzzification: getNumericalFuzzification(),
    numerical_defuzzification: getNumericalDefuzzification(),
    variance_threshold: parseFloat(
      document.getElementById("variance_threshold").value
    ),
    remove_low_variance: document.getElementById("remove_low_variance").checked,
    outlier_filtering: getOutlierFiltering(),
    num_vars: parseInt(document.getElementById("num_vars").value, 10),
    whitelist: getWhitelist(),
    blacklist: getBlacklist(),
    rule_priority_weights: {
      support_weight: parseInt(
        document.getElementById("support_weight").value,
        10
      ),
      leverage_weight: parseInt(
        document.getElementById("leverage_weight").value,
        10
      ),
      num_antecedents_weight: parseInt(
        document.getElementById("num_antecedents_weight").value,
        10
      ),
      whitelist_boolean_weight: parseInt(
        document.getElementById("whitelist_boolean_weight").value,
        10
      ),
    },
    include_intercept: document.getElementById("include_intercept").checked,
    compute_pvalues: document.getElementById("compute_pvalues").checked
  };
  console.log("Configuration object created:", config);

  worker.postMessage({ config, uploadedFile: window.uploadedFile });
});
