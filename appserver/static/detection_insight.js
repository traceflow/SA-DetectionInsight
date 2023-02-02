require([
    'underscore',
    'splunkjs/mvc',
    'splunkjs/mvc/postprocessmanager',
    'splunkjs/mvc/tableview',
    'splunkjs/mvc/dropdownview',
    'views/shared/results_table/renderers/BaseCellRenderer',
    'splunkjs/mvc/visualizationregistry',
    'splunkjs/mvc/simplexml/ready!'
], function(_, mvc, PostProcessManager, TableView, DropdownView, BaseCellRenderer, VisualizationRegistry) {
    console.log("Loading detection_insight.js");

    // Adds a percent bar to the table cell.
    var DataBarPercentCellRenderer = BaseCellRenderer.extend({
        canRender: function(cell) {
            return (cell.field === 'Percent');
        },
        render: function($td, cell) {
            $td.addClass('data-bar-cell').html(_.template('<div class="data-bar-wrapper"><div class="data-bar" style="width:<%- percent %>%"><%- percent %>%</div></div>', {
                percent: Math.min(Math.max(parseFloat(cell.value), 0), 100)
            }));
        }
    });

    // Set the style of the element to italic font and gray color when not a sparkline.
    var ItalicGrayCellRenderer = BaseCellRenderer.extend({
        canRender: function(cell) {
            return (cell.field === 'Triggering Trend' && cell.value === '<Did not trigger>');
        },
        render: function($td, cell) {
            $td.attr("style", "font-style: italic; color: #a9a9a9;");
            $td.text(cell.value);
        }
    });

    // Highlight "flag" field cells based on their state (Yes/No).
    // Syntax highlight SPL using Prism.js.
    var TableDetectionChecksCellRenderer = TableView.BaseCellRenderer.extend({
        canRender: function(cell) {
            // Enable this custom cell renderer for all the "flag" fields (6th in the row) and cells
            // that contain SPL searches.
            return cell.index === 5 || cell.field === 'Contributing Events Search';
        },
        render: function($td, cell) {
            // Add a class to the cell based on the returned value
            var value = cell.value;
            $td.text(value);
            if (value === 'Yes') {
                $td.addClass('yes-cell');
            } else if (value === 'No') {
                $td.addClass('no-cell');
            } else if (cell.field === 'Contributing Events Search') {
                if (cell.value) {
                    var prism = window.Prism || Prism || {};
                    var html = prism.highlight(value, prism.languages['splunk-spl'], 'splunk-spl');
                    $td.html(html);
                }
            }
        }
    });

    // Syntax highlight SPL using Prism.js.
    var TableDetectionDetailsCellRenderer = TableView.BaseCellRenderer.extend({
        canRender: function(cell) {
            // Enable this custom cell renderer for cells that contain SPL searches.
            return cell.field === 'Search';
        },
        render: function($td, cell) {
            var value = cell.value;
            if (cell.value) {
                var prism = window.Prism || Prism || {};
                var html = prism.highlight(value, prism.languages['splunk-spl'], 'splunk-spl');
                $td.html(html);
            }
        }
    });

    // Setup a SearchManager, TableView and DropDropView to display the detection check details.
    var TableDetectionChecksRowExpansionRenderer = TableView.BaseRowExpansionRenderer.extend({
        initialize: function() {
            // initialize will run once, so we will set up a search to be reused.
            this._searchManager = new PostProcessManager({
                id: "detection-checks-manager",
                managerid: "baseDetectionsSearch"
            });

            this._tableView = new TableView({
                id: "tableDetails",
                managerid: "detection-checks-manager",
                drilldown: "none",
                wrap: "true"
            });
            this._tableView.addCellRenderer(new TableDetectionChecksCellRenderer());

            this._dropdownView = new DropdownView({
                id: "dropdownDetails",
                default: "Yes",
                choices: [{label: "Yes", value: "Yes"}, {label: "No", value: "No"}]
            });
        },
        canRender: function(rowData) {
            return true;
        },
        render: function($container, rowData) {
            // Create the SPL search based on the check being expanded and tokens currently set for the panel.
            var tokens = mvc.Components.get("default");
            var tokenStatusValue = tokens.get("tokStatusOverview");
            var tokenDomainValue = tokens.get("tokDomainOverview");

            var checkCell = _(rowData.cells).find(function(cell) {
                return cell.field === 'Check';
            });

            var dropdownDetailsLabel = $("<label>", {id: "dropdownDetailsLabel", style: "padding-left: 14px; font-family: Splunk Platform Sans"});

            console.log("Check being expanded: ", checkCell.value);

            switch (checkCell.value) {
                case "Detection has a Contributing Event Search":
                    dropdownDetailsLabel.text("Has Search?");
                    macroName = "get_contributing_search_details";
                    break;
                case "Detection generates Notable Events":
                    dropdownDetailsLabel.text("Generates Notable Event?");
                    macroName = "get_notable_details";
                    break;
                case "Detection generates Risk":
                    dropdownDetailsLabel.text("Contributes Risk?");
                    macroName = "get_risk_details";
                    break;
                case "Detection uses Threat Intelligence Management Action":
                    dropdownDetailsLabel.text("Uses Threat Intealligence Management?");
                    macroName = "get_tim_details";
                    break;
                case "Detection is mapped to MITRE Att&ck":
                    dropdownDetailsLabel.text("Mapped to MITRE?");
                    macroName = "get_mitre_details";
                    break;
                case "Detection is mapped to CIS20":
                    dropdownDetailsLabel.text("Mapped to CIS20?");
                    macroName = "get_cis20_details";
                    break;
                case "Detection is mapped to NIST":
                    dropdownDetailsLabel.text("Mapped to NIST?");
                    macroName = "get_nist_details";
                    break;
                case "Detection is mapped to KillChain":
                    dropdownDetailsLabel.text("Mapped to KillChain?");
                    macroName = "get_killchain_details";
                    break;
                default:
                    console.error("Unexpected check value: ", checkCell.value);
            }

            var spl = '`' + macroName + '("' + tokenStatusValue + '","' + tokenDomainValue + '","' + this._dropdownView.val() + '")`';
            console.log("SPL Query:", spl);

            // Setup the Search Manager.
            this._searchManager.set({ search: spl });

            // Respond to a change event
            var searchManager = this._searchManager;
            this._dropdownView.on("change", function(e) {
                var spl = '`' + macroName + '("' + tokenStatusValue + '","' + tokenDomainValue + '","' + e + '")`';
                console.log("Updating SPL to: ", searchManager.settings.get("search"));
                searchManager.settings.unset("search");
                searchManager.settings.set("search", spl);
            });

            // $container is the jquery object where we can put out content.
            $container.addClass("details-cell");
            $container.append(dropdownDetailsLabel);
            $container.append(this._dropdownView.render().el);
            $container.append(this._tableView.render().el);
        }
    });

    // Setup a SearchManager to display the detection details (Description, SPL, other information).
    var TableDetectionDetailsRowExpansionRenderer = TableView.BaseRowExpansionRenderer.extend({
        initialize: function() {
            // initialize will run once, so we will set up a search to be reused.
            this._searchManager = new PostProcessManager({
                id: "detection-details-manager",
                managerid: "baseDetectionsSearch"
            });

            this._searchManagerDg = new PostProcessManager({
                id: "detection-dendrogram-manager",
                managerid: "baseDetectionsSearch"
            });

            this._tableView = new TableView({
                id: "tableDetectionExpandedDetails",
                managerid: "detection-details-manager",
                drilldown: "none",
                wrap: "true"
            });
            this._tableView.addCellRenderer(new TableDetectionDetailsCellRenderer());

            this._dropdownView = new DropdownView({
                id: "dropdownDg",
                default: "mitre_attack",
                choices: [{label:"Analytic Story", value: "analytic_story"}, {label:"CVEs", value: "cve"}, {label:"KillChain Phases", value: "kill_chain_phases"}, {label:"MITRE ATT&CK", value: "mitre_attack"}, {label:"Observables", value: "observable"}]
            });

            var dendrogramViz = VisualizationRegistry.getVisualizer('dendrogram_viz', 'dendrogram_viz');
            this._dendrogramView = new dendrogramViz({
                id: "dendrogramViz",
                managerid: "detection-dendrogram-manager"
            });
        },
        canRender: function(rowData) {
            return true;
        },
        render: function($container, rowData) {
            var nameCell = _(rowData.cells).find(function(cell) {
                return cell.field === 'Name';
            });

            console.log("Detection being expanded: ", nameCell.value);

            var spl = '`get_detection_details("' + nameCell.value + '")`';
            console.log("SPL Query:", spl);

            this._dropdownView.settings.set("value", "mitre_attack");
            var splDg = '`get_detection_details_mitre_attack("' + nameCell.value + '")`';
            console.log("Dendrogragh SPL Query:", splDg);

            var dropdownDetailsLabel = $("<label>", {id: "dropdownDgLabel", for: "dropdownDg", style: "padding-left: 14px; padding-top: 10px; font-family: Splunk Platform Sans"});
            dropdownDetailsLabel.text("Display relations for:");

            // Setup the Search Manager.
            this._searchManager.set({ search: spl });
            this._searchManagerDg.set({ search: splDg });

            // Respond to a change event
            var searchManager = this._searchManagerDg;
            this._dropdownView.on("change", function(e) {
                switch (e) {
                    case "analytic_story":                    
                        macroName = "get_detection_details_analytic_story";
                        break;
                    case "cve":                    
                        macroName = "get_detection_details_cve";
                        break;
                    case "kill_chain_phases":
                        macroName = "get_detection_details_killchain";
                        break;
                    case "mitre_attack":            
                        macroName = "get_detection_details_mitre_attack";
                        break;
                    case "observable":
                        macroName = "get_detection_details_observable";
                        break;
                    default:
                        console.error("Unexpected dropdown token value: ", checkCell.value);
                }
                var spl = '`' + macroName + '("' + nameCell.value + '")`';
                console.log("Updating Dendrogram SPL to: ", searchManager.settings.get("search"));
                searchManager.settings.unset("search");
                searchManager.settings.set("search", spl);
            });

            // $container is the jquery object where we can put out content.
            $container.addClass("details-cell");
            $container.append(this._tableView.render().el);
            $container.append(dropdownDetailsLabel);
            $container.append(this._dropdownView.render().el);
            $container.append(this._dendrogramView.render().el);
        }
    });

    // Register customer classes against our TableView(s).
    mvc.Components.get('tableDetectionChecks').getVisualization(function(tableView) {
        tableView.addCellRenderer(new DataBarPercentCellRenderer());
        tableView.addRowExpansionRenderer(new TableDetectionChecksRowExpansionRenderer());
    });
    mvc.Components.get('tableDetectionDetails').getVisualization(function(tableView) {
        tableView.addCellRenderer(new ItalicGrayCellRenderer());
        tableView.addRowExpansionRenderer(new TableDetectionDetailsRowExpansionRenderer());
    });
    mvc.Components.get('tableCronGroupings').getVisualization(function(tableView) {
        tableView.addCellRenderer(new DataBarPercentCellRenderer());
    });
});
