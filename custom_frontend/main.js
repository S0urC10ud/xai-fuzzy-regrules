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

function visualizeTable(rulesData) {
  // Determine if "Secondary Rules" and "P-Value" columns should be displayed
  const hasSecondaryRules = rulesData.sorted_rules.some(
    (rule) => rule.secondaryRules && rule.secondaryRules.length > 0
  );
  const hasPValue = rulesData.sorted_rules.some(
    (rule) => !isNaN(rule.pValue) && rule.pValue !== null
  );

  // Define columns with tooltips
  const columns = [
    {
      data: "title",
      title: "Rule",
      width: "20rem",
    },
    {
      data: null,
      title: "🏹",
      render: function (data, type, row) {
        // Get the last word of the rule
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

  if (hasPValue) {
    columns.push({
      data: "pValue",
      title:
        "P-Value <span class='custom-tooltip'>?\
        <span class='custom-tooltiptext'>Statistical significance of the rule.</span>\
      </span>",
      render: function (data) {
        return isNaN(data) ? "N/A" : parseFloat(data).toFixed(6);
      },
    });
  }

  const columnMap = {
    title: "Rule",
    coefficient: "Coefficient",
    priority: "Priority",
    support: "Support",
    leverage: "Leverage",
    secondaryRules: "Secondary Rules",
    pValue: "P-Value",
  };

  let thead = "<thead><tr>";
  columns.forEach(function (column) {
    thead += `<th>${column.title}</th>`;
  });
  thead += "</tr></thead>";

  // Set the table header
  $("#rulesTable").html(thead);

  // Initialize DataTable
  $("#rulesTable").DataTable().destroy();
  const table = $("#rulesTable").DataTable({
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
      // Initialize tooltips
      $(".custom-tooltip").hover(
        function () {
          $(this).find(".custom-tooltiptext").fadeIn(200);
        },
        function () {
          $(this).find(".custom-tooltiptext").fadeOut(200);
        }
      );
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

  // Populate Warnings
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
}

function toggleRightPane() {
  var rightPane = document.querySelector(".right-pane");
  var toggleButton = document.querySelector(".collapsible");

  if (rightPane.style.display === "none" || rightPane.style.display === "") {
    rightPane.style.display = "block";
  } else {
    rightPane.style.display = "none";
  }

  // Add click animation class
  toggleButton.classList.add("click-animation");

  // Remove the class after the animation ends
  setTimeout(function () {
    toggleButton.classList.remove("click-animation");
  }, 300); // Duration of the animation
}

function handleResize() {
  var rightPane = document.querySelector(".right-pane");
  if (window.innerWidth > 768) {
    rightPane.style.display = "block";
  } else {
    rightPane.style.display = "none";
  }
}

window.addEventListener("resize", handleResize);

// Initial check on page load
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
    // Add event listener to the column-name input
    const columnNameInput = fieldset.querySelector(".column-name");
    const legend = fieldset.querySelector("legend");

    columnNameInput.addEventListener('input', async () => {
      const value = columnNameInput.value.trim();
      legend.textContent = value ? value : 'New Column';

      // Check if the uploaded file is set and column name is provided
      if (window.uploadedFile && value) {
        try {
          // Parse the CSV data
          const data = await parseCSV(window.uploadedFile);
          if (data && data[value]) {
            // Display box plot
            displayBoxPlot(data[value], fieldset, value);
          } else {
            // Handle case where the column does not exist
            console.warn(`Column "${value}" not found in the uploaded CSV file.`);
          }
        } catch (error) {
          console.error('Error parsing CSV:', error);
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

// Function to parse CSV data
async function parseCSV(csvString) {
  return new Promise((resolve, reject) => {
    Papa.parse(csvString, {
      header: true,
      dynamicTyping: true,
      complete: function(results) {
        // Transform data into a column-based format
        const columns = {};
        results.meta.fields.forEach(field => {
          columns[field] = results.data
            .map(row => row[field])
            .filter(val => val != null && val !== '');
        });
        resolve(columns);
      },
      error: function(err) {
        reject(err);
      }
    });
  });
}

function displayBoxPlot(columnData, container, columnName) {
  // Remove existing canvas if any
  const existingCanvas = container.querySelector('.boxplot-canvas');
  if (existingCanvas) {
    existingCanvas.remove();
  }

  // Create a canvas element
  const canvas = document.createElement('canvas');
  canvas.className = 'boxplot-canvas';
  canvas.style.width = '100%';
  container.appendChild(canvas);

  // Adjust container styling if needed
  container.style.position = 'relative';

  // Create the box plot using Chart.js
  new Chart(canvas.getContext('2d'), {
    type: 'boxplot',
    data: {
      labels: [columnName],
      datasets: [{
        label: columnName,
        data: [columnData],
        backgroundColor: 'rgba(255, 204, 0, 0.5)',
        borderColor: 'rgba(255, 204, 0, 1)',
        borderWidth: 1
      }],
    },
    options: {
      indexAxis: 'y', // Make the box plot horizontal
      responsive: false,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          enabled: true
        }
      },
      scales: {
        x: {
          display: true,
          title: {
            display: true,
            text: columnName
          }
        },
        y: {
          display: true
        }
      }
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
    link.href = "assets/biased_salaries.csv";
    link.download = "biased_salaries.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Hide modal after download
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
    config.include_intercept ?? false;
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

  // Advanced Settings
  document.getElementById("only_one_round_stat_removal").checked =
    config.rule_filters.only_one_round_of_statistical_removal ?? true;
  document.getElementById("only_one_round_lin_removal").checked =
    config.rule_filters.only_one_round_of_linearity_removal ?? true;

  console.log("Configuration pane updated with demo configuration.");

  // Hide choice-container and show rules table
  document.getElementById("choice-container").style.display = "none";
  document.getElementById("main-content-container").style.display = "grid";

  // Fetch and display rules
  const rulesResponse = await fetch("assets/biased_salaries.json");
  if (!rulesResponse.ok) {
    throw new Error("Failed to fetch biased salaries data");
  }
  const rulesData = await rulesResponse.json();

  visualizeTable(rulesData);
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

// Function to read file and store content
function handleFileUpload(fileInput, fileNumber) {
  const file = fileInput.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = function (e) {
      if (fileNumber === 1) {
        window.uploadedFile = e.target.result;
      } else {
        window.uploadedFile = e.target.result;
      }
    };
    reader.readAsText(file);

    document.getElementById("runButton").disabled = false;
    // Success message elements
    document.getElementById("uploadButton1").textContent = "Uploaded File✔️";
    document.getElementById("uploadButton1").style.backgroundColor = "#ffcc00";
    document.getElementById("uploadButton1").style.color = "black";

    document.getElementById("uploadButton2").childNodes[1].textContent = "✔️";
    document.getElementById("uploadButton2").childNodes[3].textContent =
      "Successfully read the file! Now configure and run!";
    document.getElementById("uploadButton2").childNodes[3].style.color =
      "black";
    document.getElementById("uploadButton2").style.backgroundColor = "#ffcc00";

    runButton.classList.add("pulsing-button");

    // if viewport width is less than 768px, toggle show the configuration pane
    const rightPane = document.querySelector(".right-pane");

    if (
      (window.innerWidth <= 768 && rightPane.style.display === "none") ||
      rightPane.style.display === ""
    ) {
      toggleRightPane();
    }
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
      only_one_round_of_statistical_removal: document.getElementById(
        "only_one_round_stat_removal"
      ).checked,
      only_one_round_of_linearity_removal: document.getElementById(
        "only_one_round_lin_removal"
      ).checked,
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
  };

  // Store the config object for later use
  console.log("Configuration object created:", config);

  worker.postMessage({ config, uploadedFile: window.uploadedFile });
});
