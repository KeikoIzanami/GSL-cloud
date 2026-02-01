import QtQuick 2.9
import QtQuick.Controls 2.2
import QtQuick.Layouts 1.3
import QtQuick.Controls.Material 2.2

Rectangle {
    id: loginView
    color: Material.backgroundColor
    objectName: "Login"

    // Signal để báo đã login thành công
    signal loginSuccessful(string userId, string username)

    property string apiBaseUrl: "http://localhost:3000"
    property bool isLoading: false

    function performLogin() {
        if (usernameField.text.length === 0 || passwordField.text.length === 0) {
            errorLabel.text = "Vui lòng nhập tên đăng nhập và mật khẩu"
            errorLabel.visible = true
            return
        }

        isLoading = true
        errorLabel.visible = false

        var xhr = new XMLHttpRequest()
        xhr.open("POST", apiBaseUrl + "/login", true)
        xhr.setRequestHeader("Content-Type", "application/json")

        var payload = {
            username: usernameField.text,
            password: passwordField.text
        }

        xhr.onreadystatechange = function() {
            if (xhr.readyState === XMLHttpRequest.DONE) {
                isLoading = false
                if (xhr.status === 200) {
                    try {
                        var response = JSON.parse(xhr.responseText)
                        if (response.success && response.data) {
                            console.log("Login successful:", response.data)
                            // Emit signal để báo login thành công
                            loginSuccessful(response.data.userId, response.data.username)
                        } else {
                            errorLabel.text = response.message || "Đăng nhập thất bại"
                            errorLabel.visible = true
                        }
                    } catch (e) {
                        errorLabel.text = "Lỗi: " + e.toString()
                        errorLabel.visible = true
                    }
                } else {
                    try {
                        var errorResponse = JSON.parse(xhr.responseText)
                        errorLabel.text = errorResponse.message || "Lỗi kết nối"
                    } catch (e) {
                        errorLabel.text = "Lỗi kết nối tới server"
                    }
                    errorLabel.visible = true
                }
            }
        }

        xhr.onerror = function() {
            isLoading = false
            errorLabel.text = "Không thể kết nối tới server"
            errorLabel.visible = true
        }

        xhr.send(JSON.stringify(payload))
    }

    ColumnLayout {
        anchors.centerIn: parent
        width: Math.min(400, parent.width - 40)
        spacing: 20

        // Header
        Label {
            text: "GSL Cloud Gaming"
            font.pixelSize: 28
            font.bold: true
            color: Material.accent
            horizontalAlignment: Text.AlignHCenter
            Layout.fillWidth: true
        }

        Label {
            text: "Đăng Nhập"
            font.pixelSize: 20
            color: Material.foreground
            horizontalAlignment: Text.AlignHCenter
            Layout.fillWidth: true
        }

        // Spacer
        Item {
            Layout.fillHeight: true
            Layout.preferredHeight: 20
        }

        // Error message
        Rectangle {
            visible: errorLabel.visible
            color: Material.backgroundColor
            radius: 4
            Layout.fillWidth: true
            Layout.preferredHeight: errorLabel.visible ? errorColumn.implicitHeight + 10 : 0
            clip: true

            ColumnLayout {
                id: errorColumn
                anchors.fill: parent
                anchors.margins: 5
                spacing: 5

                Label {
                    id: errorLabel
                    text: ""
                    color: "#ff6b6b"
                    wrapMode: Text.WordWrap
                    Layout.fillWidth: true
                    visible: false
                }
            }
        }

        // Username field
        Column {
            Layout.fillWidth: true
            spacing: 5

            Label {
                text: "Tên đăng nhập"
                font.pixelSize: 12
                color: Material.foreground
            }

            TextField {
                id: usernameField
                placeholderText: "Nhập tên đăng nhập"
                width: parent.width
                enabled: !isLoading

                Keys.onReturnPressed: {
                    if (!isLoading) {
                        performLogin()
                    }
                }

                Keys.onEnterPressed: {
                    if (!isLoading) {
                        performLogin()
                    }
                }
            }
        }

        // Password field
        Column {
            Layout.fillWidth: true
            spacing: 5

            Label {
                text: "Mật khẩu"
                font.pixelSize: 12
                color: Material.foreground
            }

            TextField {
                id: passwordField
                placeholderText: "Nhập mật khẩu"
                width: parent.width
                echoMode: TextInput.Password
                enabled: !isLoading

                Keys.onReturnPressed: {
                    if (!isLoading) {
                        performLogin()
                    }
                }

                Keys.onEnterPressed: {
                    if (!isLoading) {
                        performLogin()
                    }
                }
            }
        }

        // Login button
        Button {
            text: isLoading ? "Đang đăng nhập..." : "Đăng Nhập"
            Layout.fillWidth: true
            Layout.preferredHeight: 48
            enabled: !isLoading
            Material.accent: Material.Orange

            onClicked: {
                performLogin()
            }
        }

        // Spacer
        Item {
            Layout.fillHeight: true
            Layout.preferredHeight: 20
        }
    }
}
