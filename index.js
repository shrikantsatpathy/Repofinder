//Constants
var express = require('express')
var app = express()
var axios = require('axios');
var bodyParser = require('body-parser')
var port = process.env.PORT || 8080

var urlencodedParser = bodyParser.urlencoded({ extended: false })
var access_token = ""
var repoDetailsViewPath = "/views/repodetails"

require('dotenv').config();

app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');
app.use("/static", express.static('./static/'));
app.use(express.static(__dirname + '/public'));

// This is the callback method for github to generate the authentication token.
// The github API rate limits is 60/hour, Authentication increases this limit to 5K/hour
app.get('/github/callback', (req, res) => {
    console.log("hit /github/callback")
    const requestToken = req.query.code
    const gitHubAuthUrl = `https://github.com/login/oauth/access_token?client_id=${process.env.GITHUB_CLIENT_ID}&client_secret=${process.env.GITHUB_CLIENT_SECRET}&code=${requestToken}`
    axios({
        method: 'post',
        url: gitHubAuthUrl,
        headers: {
            accept: 'application/json'
        }
    }).then((response) => {
        console.log("Sucesfully authenticated the user")
        access_token = response.data.access_token
        repoDetailsList = []
        res.redirect("/repoDetailsform")
    })
})

/**
 * This will be executed when the user hits the root url.
 */
app.get('/', (req, res) => {
    console.log('Loading home page')
    repoDetailsList = []
    res.render(__dirname + "/views/main.ejs", { repoDetailsList: repoDetailsList })
})

/**
 * This will be executed when the user hits the authenticate button to show the repo finder form.
 */
app.get('/repoDetailsform', (req, res) => {
    repoDetailsList = []
    res.render(__dirname + repoDetailsViewPath, { repoDetailsList: repoDetailsList })
})

/**
 * This will be executed when the user submitted the input to get the top N authors of the top M repositories.
 */
app.post('/', urlencodedParser, function (req, res) {
    try {
        renderRepoDetails(req, res);
    } catch (error) {
        console.log(error)
    }
})

/**
 * This method is responsible to render the repository details in the UI.
 * @param {*} req 
 * @param {*} res 
 */
async function renderRepoDetails(req, res) {
    var organization = req.body.orgname;
    var noOfRepos = req.body.n;
    var noOfAuthors = req.body.m;
    var repoDetailsList = new Array();

    //Get top repositories
    var topRepoList = await getTopRepos(organization, noOfRepos);

    //Get top authors of top repositories
    for (let i = 0; i < topRepoList.length; i++) {
        topAuthors = await getTopAuthors(topRepoList[i], noOfAuthors).catch(error => {
            console.log(error);
        });;
        repoDetailsList.push(new RepoDetail(topRepoList[i].full_name, topRepoList[i].forks_count, topAuthors));
    }
    res.render(__dirname + "/views/main.ejs", { repoDetailsList: repoDetailsList });
    console.log('Loaded the repository details')
}

/**
 * Get top respositories.
 * @param {*} organization organization name for which the method returns the top repositories
 * @param {*} noOfRepos No of top repositories to be returned
 */
async function getTopRepos(organization, noOfRepos) {

    // Used client_id and client_secret to increase API call limit
    var searchOrgReposUrl = "https://api.github.com/orgs/" + organization + "/repos?per_page=100";
    var topRepoList = [];
    await axios.get(searchOrgReposUrl, {
        headers: {
            Authorization: 'token ' + access_token
        }
    }).then(async (resp) => {
        const link = resp.headers.link;
        var totalPages = link ? parseInt(link.split(",")[1].split(">")[0].split("&page=")[1]) : 1
        console.log(totalPages + " totalPages")
        if (totalPages > 1) { // Organization with more than 1 page 
            topRepoList = await getTopReposFromMultiplePages(totalPages, organization, noOfRepos);
        }
        else { // Organization with only 1 page
            console.log("Getting top repos for organization " + organization + " with single page")
            topRepoList = resp.data.sort((a, b) => b.forks_count - a.forks_count).slice(0, noOfRepos);
            console.log("Fetched top repos for organization " + organization + " with single page")
        }
    })
        .catch(error => {
            console.log(error);
        });

    return topRepoList;
}

/**
 * This method is responsible to get the Top N repositories for org with more than one page of repositories.
 * @param {Array} orgName The name of the organization for which the method returns top N repos
 * @param {Intege} n The number of repositories to be returned by the method
 */
async function getTopReposFromMultiplePages(noOfPages, orgName, n) {

    const repoUrlListPerPage = []
    var flag = true;
    var topNReposAcrossPages = []
    console.log("Getting top repos for organization " + orgName + " with multiple page")

    for (let i = 1; i < 2 + 1; i++) {
        repoPageUrl = `https://api.github.com/search/repositories?q=org:${orgName}&sort=forks&order=desc&per_page=100&page=` + i
        await axios.get(repoPageUrl, {
            headers: {
                Authorization: 'token ' + access_token
            }
        }).then(resp => {
            //Sorting top n respository of particular page based on fork_count (total fork) and slicing top n           
            resp.data.items.forEach(element => {
                topNReposAcrossPages.push(element)
            }
            )
        });

    }

    console.log("Fetched top repos for organization " + orgName + " with multiple page")
    return topNReposAcrossPages.slice(0, n);
}

/**
 * Get the top m authors for the given repository
 * @param {*} repo repository name
 * @param {*} m  number of authors for the given  repo
 */
async function getTopAuthors(repo, m) {
    getAuthorUrl = `https://api.github.com/repos/` + repo.full_name + `/contributors?per_page=100&page=1`;
    //console.log("Getting top authors for repository : " + repo.full_name)
    try {
        var sortedAuthorsJsonList = await axios.get(getAuthorUrl, {
            headers: {
                Authorization: 'token ' + access_token
            }
        })
        sortedAuthorsJsonList = sortedAuthorsJsonList.data.slice(0, m)
        var sortedAuthorList = sortedAuthorsJsonList.map(value => {
            return {
                name: value.login,
                contributions: value.contributions
            }
        })
        //console.log("Fetched top authors for repository : " + repo.full_name)
        return sortedAuthorList;
    }
    catch (error) {
        //The history or contributor list is too large to list contributors for this repository via the API
        console.log("Can't fetch results for url : " + getAuthorUrl);
        return [{
            name: "cannot get top Authors please visit github",
            contributions: ""
        }]
    }

}

/**
 * This class contains the details of the repository to be displayed in the UI
 */
class RepoDetail {
    constructor(repoName, forkCount, authors) {
        this.repoName = repoName
        this.forkCount = forkCount
        this.authors = authors
    }
}

//Start the server
var server = app.listen(port, function () {
    console.log("app running" + port)
})
server.setTimeout(500000);


