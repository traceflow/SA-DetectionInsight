require([
    'underscore',
    'splunkjs/mvc',
    'splunkjs/mvc/searchmanager',
    'splunkjs/mvc/postprocessmanager',
    'splunkjs/mvc/tableview',
    'splunkjs/mvc/dropdownview',
    'views/shared/results_table/renderers/BaseCellRenderer',
    'splunkjs/mvc/visualizationregistry',
    '/static/app/SA-DetectionInsight/modal.js',
    'splunkjs/mvc/utils',
    'splunkjs/mvc/simplexml/ready!'
], function(_, mvc, SearchManager, PostProcessManager, TableView, DropdownView, BaseCellRenderer, VisualizationRegistry, Modal, utils) {
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
            // Enable this custom cell renderer for all Detection titles, the "flag" fields (6th in the row) and cells
            // that contain SPL searches.
            return cell.index === 5 || cell.field === 'Name' || cell.field === 'Contributing Events Search';
        },
        render: function($td, cell) {
            // Create hyperlink to detection configuration page.
            if (cell.field === 'Name') {
                var encoded = encodeURIComponent(cell.value);
                var link = $("<a>", {href: "/app/SplunkEnterpriseSecuritySuite/correlation_search_edit?search=" + encoded, target: "_blank", text: cell.value});
                    link.on("click", function() {
                    window.open($(this).attr("href"));
                });
                $td.append(link);
            } else {
                var value = cell.value;
                $td.text(value);
            }

            // Add a class to the cell based on the returned value
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
            var macroCell = _(rowData.cells).find(function(cell) {
                return cell.field === 'details_search_macro';
            });
            var labelCell = _(rowData.cells).find(function(cell) {
                return cell.field === 'details_search_label';
            });

            var dropdownDetailsLabel = $("<label>", {id: "dropdownDetailsLabel", style: "padding-left: 14px; font-family: Splunk Platform Sans"});

            console.log("Check being expanded: ", checkCell.value);

            dropdownDetailsLabel.text(labelCell.value);
            macroName = macroCell.value;

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

    // Setup SearchManagers to display the detection details (Description, SPL, other information).
    var TableDetectionDetailsRowExpansionRenderer = TableView.BaseRowExpansionRenderer.extend({
        initialize: function() {
            // initialize will run once, so we will set up search managers to be reused.
            this._searchManager = new PostProcessManager({
                id: "detection-details-manager",
                managerid: "baseDetectionsSearch"
            });

            this._searchAnnotationsManager = new PostProcessManager({
                id: "detection-annotations-manager",
                managerid: "baseDetectionsSearch",
                preview: false
            });

            this._tableView = new TableView({
                id: "tableDetectionExpandedDetails",
                managerid: "detection-details-manager",
                drilldown: "none",
                wrap: "true"
            });
            this._tableView.addCellRenderer(new TableDetectionDetailsCellRenderer());
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

            var splAnnotations = '`get_detection_annotations("' + nameCell.value + '")`';
            console.log("SPL Annotations Query:", splAnnotations);

            // Setup the Search Managers searches.
            this._searchManager.set({ search: spl });
            this._searchAnnotationsManager.set({ search: splAnnotations });

            // $container is the jquery object where we can put out content.
            $container.addClass("details-cell");
            $container.append(this._tableView.render().el);

            var annotationData = this._searchAnnotationsManager.data("results");
            annotationData.on("data", function() {
                if ($('#tableAnnotations').length) {
                     $('#tableAnnotations').remove();
                }

                // Get the backing Backbone collection's data.
                var collection = annotationData.collection();
                var model = collection.at(0);
                var annotationResults = model.attributes;

                var analyticStories = [].concat(annotationResults["analytic_story"] || "N/A");
                var context = [].concat(annotationResults["context"] || "N/A");
                var cis20 = [].concat(annotationResults["cis20"] || "N/A");
                var cves = [].concat(annotationResults["cve"] || "N/A");
                var killChain = [].concat(annotationResults["kill_chain_phases"] || "N/A");
                var mitreAttack = [].concat(annotationResults["mitre_attack"] || "N/A");
                var nist = [].concat(annotationResults["nist"] || "N/A");
                var observables = [].concat(annotationResults["observable"] || "N/A");
                var confidence = [].concat(annotationResults["confidence"] || "N/A");
                var impact = [].concat(annotationResults["impact"] || "N/A");

                // Render using a custom HTML table.
                var annotationTable = $("<table>", {id: "tableAnnotations"});
                annotationTable.append('<tr><td id="annotationContext"/><td id="annotationStories"/><td id="annotationCVEs"/><td id="annotationMitre"/><td id="annotationCIS20"/><td id="annotationNIST"/><td id="annotationKillchain"/><td id="annotationConfidence"/><td id="annotationImpact"/></tr>');
                $container.append(annotationTable);

                $('#annotationStories').append("<h3 class='annotationHeader'>Analytic Stories</h3>");
                _.each(analyticStories, function(val, key) {
                    var entry = $("<div>", {class: "annotationDiv"});
                    if (val != "N/A") {
                        var link = $("<a>", {href: "/app/SplunkEnterpriseSecuritySuite/ess_analytic_story_details?analytic_story=" + val, target: "_blank", text: val});
                        link.on("click", function() {
                            window.open($(this).attr("href"));
                        });
                        entry.addClass("annotationStories");
                        entry.append(link);
                    } else {
                        entry.text(val);
                    }
                    $('#annotationStories').append(entry);
                });

                $('#annotationContext').append("<h3 class='annotationHeader'>Context</h3>");
                _.each(context, function(val, key) {
                    var entry = $("<div>", {class: "annotationDiv", text: val});
                    if (val != "N/A") {
                        entry.addClass("annotationContext");
                    }
                    $('#annotationContext').append(entry);
                });

                $('#annotationCIS20').append("<h3 class='annotationHeader'>CIS 20</h3>");
                _.each(cis20, function(val, key) {
                    var entry = $("<div>", {
                        class: "annotationDiv annotationTooltip",
                        "data-placement": "right"
                    });
                    if (val != "N/A") {
                        // The CIS20 field comes as a pipe separated multivalue containing: <Control ID>|<Description>.
                        var fields = [].concat(val.split("|"));
                        var link = $("<a>", {
                            href: "https://www.cisecurity.org/controls/cis-controls-list", 
                            target: "_blank", 
                            text: fields[0]
                        });
                        link.on("click", function() {
                            window.open($(this).attr("href"));
                        });
                        entry.addClass("annotationCIS20");
                        entry.append(link);
                        // Setup tooltip.
                        entry.attr("title", fields[1]);
                        entry.tooltip();
                    } else {
                        entry.text(val);
                    }
                    $('#annotationCIS20').append(entry);
                });

                 $('#annotationCVEs').append("<h3 class='annotationHeader'>CVEs</h3>");
                _.each(cves, function(val, key) {
                    var entry = $("<div>", {class: "annotationDiv"});
                    if (val != "N/A") {
                        var link = $("<a>", {href: "https://nvd.nist.gov/vuln/detail/" + val, target: "_blank", text: val});
                        link.on("click", function() {
                            window.open($(this).attr("href"));
                        });
                        entry.addClass("annotationCVEs");
                        entry.append(link);
                    } else {
                        entry.text(val);
                    }
                    $('#annotationCVEs').append(entry);
                });

                $('#annotationKillchain').append("<h3 class='annotationHeader'>KillChain Phases</h3>");
                _.each(killChain, function(val, key) {
                    var entry = $("<div>", {class: "annotationDiv"});
                    if (val != "N/A") {
                        var link = $("<a>", {href: "https://www.lockheedmartin.com/en-us/capabilities/cyber/cyber-kill-chain.html", target: "_blank", text: val});
                        link.on("click", function() {
                            window.open($(this).attr("href"));
                        });
                        entry.addClass("annotationKillchain");
                        entry.append(link);
                    } else {
                        entry.text(val);
                    }
                    $('#annotationKillchain').append(entry);
                });

                $('#annotationMitre').append("<h3 class='annotationHeader'>MITRE ATT&amp;CK</h3>");
                _.each(mitreAttack, function(val, key) {
                    var entry = $("<div>", {
                        class: "annotationDiv annotationTooltip",
                        "data-placement": "right"
                    });
                    if (/^T[\d\.]+/.test(val)) {
                        // The mitre technique field comes as a pipe separated multivalue containing: <ID>|<Technique Description>.
                        var fields = [].concat(val.split("|"));
                        var link = $("<a>", {
                            href: "https://attack.mitre.org/techniques/" + fields[0].replace(/\./g, "\/"), 
                            target: "_blank", 
                            text: fields[0]
                        });
                        link.on("click", function() {
                            window.open($(this).attr("href"));
                        });
                        entry.addClass("annotationMITRE");
                        entry.append(link);
                        // Setup tooltip.
                        entry.attr("title", fields[1]);
                        entry.tooltip();
                    } else {
                        entry.text(val);
                    }
                    $('#annotationMitre').append(entry);
                });

                $('#annotationNIST').append("<h3 class='annotationHeader'>NIST</h3>");
                _.each(nist, function(val, key) {
                    var entry = $("<div>", {
                        class: "annotationDiv annotationTooltip",
                        "data-placement": "right"
                    });
                    if (val != "N/A") {
                        // The NIST field comes as a pipe separated multivalue containing: <ID>|<Description>.
                        var fields = [].concat(val.split("|"));
                        // The ID is actually the Category and Function 2 letter codes separated by a dot, e.g.: ID.AM.
                        var categories = [].concat(fields[0].split("."));
                        if (categories.length >= 2) 
                        var link = $("<a>", {
                            href: "https://csf.tools/reference/nist-cybersecurity-framework/v1-1/" + categories[0] + "/" + categories[1] + "/", 
                            target: "_blank", 
                            text: fields[0]
                        });
                        link.on("click", function() {
                            window.open($(this).attr("href"));
                        });
                        entry.addClass("annotationNIST");
                        entry.append(link);
                        // Setup tooltip.
                        entry.attr("title", fields[1]);
                        entry.tooltip();
                    } else {
                        entry.text(val);
                    }
                    $('#annotationNIST').append(entry);
                });

                $('#annotationConfidence').append("<h3 class='annotationHeader'>Confidence</h3>");
                _.each(confidence, function(val, key) {
                    var entry = $("<div>", {class: "annotationDiv", text: val});
                    if (val != "N/A") {
                        entry.addClass("annotationConfidence");
                    }
                    $('#annotationConfidence').append(entry);
                });

                $('#annotationImpact').append("<h3 class='annotationHeader'>Impact</h3>");
                _.each(impact, function(val, key) {
                    var entry = $("<div>", {class: "annotationDiv", text: val});
                    if (val != "N/A") {
                        entry.addClass("annotationImpact");
                    }
                    $('#annotationImpact').append(entry);
                });
            });
        }
    });

    // Register custom classes against our TableView(s).
    mvc.Components.get('tableDetectionChecks').getVisualization(function(tableView) {
        tableView.addCellRenderer(new DataBarPercentCellRenderer());
        tableView.addRowExpansionRenderer(new TableDetectionChecksRowExpansionRenderer());
    });
    mvc.Components.get('tableDetectionDetails').getVisualization(function(tableView) {
        tableView.addCellRenderer(new ItalicGrayCellRenderer());
        tableView.addCellRenderer(new TableDetectionChecksCellRenderer());
        tableView.addRowExpansionRenderer(new TableDetectionDetailsRowExpansionRenderer());
    });
    mvc.Components.get('tableCronGroupings').getVisualization(function(tableView) {
        tableView.addCellRenderer(new DataBarPercentCellRenderer());
    });
    mvc.Components.get('tableDetectionChangesEnterprise').getVisualization(function(tableView) {
        tableView.addCellRenderer(new TableDetectionChecksCellRenderer());
    });
    mvc.Components.get('tableDetectionChangesCloud').getVisualization(function(tableView) {
        tableView.addCellRenderer(new TableDetectionChecksCellRenderer());
    });
    mvc.Components.get('tableScheduledSearchDetails').getVisualization(function(tableView) {
        tableView.addCellRenderer(new TableDetectionChecksCellRenderer());
    });

    // Check initial setup has been done.
    // This runs a search to check if the lookup file exists and return it's name if it does.
    // If this returns no results, inform the user and give him/her a chance to configure it properly.
    if(localStorage.getItem('SA-DetectionInsight_doNotShowSetupDialog') === null) {
        var searchId = "checkBaseLookupIsPopulated"
        if (typeof mvc.Components.getInstance(searchId) == "object") {
            mvc.Components.revokeInstance(searchId)
        }
        var searchManager = new SearchManager({
            "id": searchId,
            "cancelOnUnload": true,
            "latest_time": "",
            "status_buckets": 0,
            "earliest_time": "0",
            "search": '| rest splunk_server=local /services/admin/lookup-table-files | fields title | search title = "all_saved_searches.csv"',
            "app": utils.getCurrentApp(),
            "preview": true,
            "runWhenTimeIsUndefined": false,
            "autostart": true
        }, { 
            tokens: true, 
            tokenNamespace: "submitted" 
        });

        searchManager.on('search:done', function(properties) {
            if (properties.content.resultCount == 0) {
                console.log("Lookup is not configured yet.");
                var myModal = new Modal("modalInitialSetup", {
                        title: "Important Note - Initial Setup",
                        backdrop: 'static',
                        keyboard: true,
                        destroyOnHide: true,
                        type: 'normal'
                    });
                myModal.body.append($('<p>This add-on uses a lookup which is generated by the saved search named <b>DetectionInsight - All Saved Searches - Lookup Gen</b>.</p>' +
                    '<p>It seems the search has not been run yet as the lookup is empty.</p>' +
                    '<p>Click <a href="/app/search/search?s=%2FservicesNS%2Fnobody%2FSA-DetectionInsight%2Fsaved%2Fsearches%2FDetectionInsight%2520-%2520All%2520Saved%2520Searches%2520-%2520Lookup%2520Gen&sid=1683055763.437&display.page.search.mode=smart&dispatch.sample_ratio=1&workload_pool=&q=%7C%20rest%20splunk_server%3Dlocal%20count%3D0%20add_orphan_field%3Dyes%20%2Fservices%2Fsaved%2Fsearches%0A%7C%20outputlookup%20all_saved_searches.csv&earliest=-1m&latest=now">here</a> to go to the report and run it/ensure it is scheduled.</p>'));
                
                var myDiv = $('<div>').attr({
                    style: "text-align: left; width: 100%;"
                });
                myDiv.append($('<label>').attr({
                    for: "chkNoReminder",
                    style: "display: inline-block; margin-right: 1em;"
                }).text("Do not show again"));
                myDiv.append($('<input>').attr({
                    id: "chkNoReminder",
                    type: "checkbox",
                    style: "display: inline-block;"
                }));
                myModal.footer.append(myDiv);
                myModal.footer.append($('<button>').attr({
                    type: 'button',
                    'data-dismiss': 'modal',
                    class: 'btn btn-primary'
                }).text('Close').on('click', function() {
                    var dontShowAgain = $("#chkNoReminder").is(':checked');
                    if(dontShowAgain) {
                        // Save user decision not to see this message again in LocalStorage.
                        localStorage.setItem('SA-DetectionInsight_doNotShowSetupDialog', dontShowAgain);
                    }
                }));
                myModal.show();
            } else {
                console.log("Lookup is already configured/present.");
            }
        });
    }

    // Allow collapsing sections.
    $(".collapsibleButton").click(function(){
        this.classList.toggle("collapsibleActive");
        var content = this.nextElementSibling;
        if (content.style.maxHeight){
                content.style.maxHeight = null;
        } else {
                content.style.maxHeight = content.scrollHeight + "px";
        }
    });
});
