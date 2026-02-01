import QtQuick 2.9

Item {
    id: startupHelper

    property string apiBaseUrl: "http://localhost:3000"

    Component.onCompleted: {
        // Auto-create demo user on startup
        createDemoUser()
    }

    function createDemoUser() {
        var xhr = new XMLHttpRequest()
        xhr.open("POST", apiBaseUrl + "/seed-demo-user", true)
        xhr.setRequestHeader("Content-Type", "application/json")

        xhr.onreadystatechange = function() {
            if (xhr.readyState === XMLHttpRequest.DONE) {
                if (xhr.status === 200) {
                    console.log("Demo user initialized")
                }
            }
        }

        xhr.send()
    }
}
