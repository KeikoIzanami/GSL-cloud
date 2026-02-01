import QtQuick 2.9
import QtQuick.Controls 2.2
import QtQuick.Layouts 1.3
import QtQuick.Controls.Material 2.2

Rectangle {
    id: hostingView
    color: Material.backgroundColor
    objectName: "Hosting"

    // Signal để quay lại
    signal backClicked()

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 20
        spacing: 20

        // Header
        RowLayout {
            Layout.fillWidth: true
            spacing: 10

            Button {
                text: "← Quay lại"
                onClicked: backClicked()
            }

            Label {
                text: "Thuê Máy Chơi Game"
                font.pixelSize: 24
                font.bold: true
                Layout.fillWidth: true
            }
        }

        // Question
        ColumnLayout {
            Layout.fillWidth: true
            spacing: 10

            Label {
                text: "Bạn muốn thuê loại cấu hình nào? (~⏳~)"
                font.pixelSize: 18
                font.bold: true
                horizontalAlignment: Text.AlignHCenter
                Layout.fillWidth: true
            }

            RowLayout {
                Layout.fillWidth: true
                Layout.alignment: Qt.AlignHCenter
                spacing: 10

                Button {
                    text: "Trả theo giờ"
                    highlighted: true
                }

                Button {
                    text: "Gói đăng ký"
                }
            }
        }

        // Packages Grid
        GridLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            columns: 4
            columnSpacing: 15
            rowSpacing: 15

            // Basic Package
            Rectangle {
                Layout.fillWidth: true
                Layout.fillHeight: true
                color: "#3a4a5a"
                radius: 10

                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: 15
                    spacing: 10

                    Label {
                        text: "CƠ BẢN"
                        font.pixelSize: 16
                        font.bold: true
                        color: "#ffffff"
                    }

                    Label {
                        text: "7.000₫/h"
                        font.pixelSize: 20
                        font.bold: true
                        color: "#00ff00"
                    }

                    Label {
                        text: "Game nào cũng chơi được."
                        font.pixelSize: 12
                        color: "#cccccc"
                        wrapMode: Text.WordWrap
                    }

                    Rectangle {
                        height: 1
                        Layout.fillWidth: true
                        color: "#555555"
                    }

                    Label {
                        text: "Cấu hình máy"
                        font.pixelSize: 12
                        font.bold: true
                        color: "#ffffff"
                    }

                    ColumnLayout {
                        spacing: 5
                        Layout.fillWidth: true

                        RowLayout {
                            spacing: 5
                            Image {
                                source: "qrc:/res/cpu.svg"
                                width: 16
                                height: 16
                            }
                            Label {
                                text: "Core i5 12400F"
                                font.pixelSize: 11
                                color: "#cccccc"
                            }
                        }

                        RowLayout {
                            spacing: 5
                            Image {
                                source: "qrc:/res/gpu.svg"
                                width: 16
                                height: 16
                            }
                            Label {
                                text: "RTX 2060S 8GB"
                                font.pixelSize: 11
                                color: "#cccccc"
                            }
                        }

                        RowLayout {
                            spacing: 5
                            Image {
                                source: "qrc:/res/ram.svg"
                                width: 16
                                height: 16
                            }
                            Label {
                                text: "32GB RAM"
                                font.pixelSize: 11
                                color: "#cccccc"
                            }
                        }
                    }

                    Item {
                        Layout.fillHeight: true
                    }

                    Button {
                        text: "THUÊ NGAY"
                        Layout.fillWidth: true
                        Material.accent: Material.Orange
                        onClicked: {
                            console.log("Subscribe to Basic package")
                        }
                    }
                }
            }

            // Standard Package (Popular)
            Rectangle {
                Layout.fillWidth: true
                Layout.fillHeight: true
                color: "#1a7a3a"
                radius: 10
                border.color: "#00ff00"
                border.width: 2

                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: 15
                    spacing: 10

                    RowLayout {
                        spacing: 10

                        Label {
                            text: "TIÊU CHUẨN"
                            font.pixelSize: 16
                            font.bold: true
                            color: "#ffffff"
                            Layout.fillWidth: true
                        }

                        Rectangle {
                            color: "#ff3333"
                            radius: 4
                            Layout.preferredWidth: 70
                            Layout.preferredHeight: 20

                            Label {
                                anchors.centerIn: parent
                                text: "UNITD. PLUS"
                                font.pixelSize: 10
                                font.bold: true
                                color: "#ffffff"
                            }
                        }
                    }

                    Label {
                        text: "10.000₫/h"
                        font.pixelSize: 24
                        font.bold: true
                        color: "#00ff00"
                    }

                    Label {
                        text: "Cần mọi tính năng game."
                        font.pixelSize: 12
                        color: "#cccccc"
                        wrapMode: Text.WordWrap
                    }

                    Rectangle {
                        height: 1
                        Layout.fillWidth: true
                        color: "#00ff00"
                    }

                    Label {
                        text: "Cấu hình máy"
                        font.pixelSize: 12
                        font.bold: true
                        color: "#ffffff"
                    }

                    ColumnLayout {
                        spacing: 5
                        Layout.fillWidth: true

                        RowLayout {
                            spacing: 5
                            Image {
                                source: "qrc:/res/cpu.svg"
                                width: 16
                                height: 16
                            }
                            Label {
                                text: "Core i5 12400F"
                                font.pixelSize: 11
                                color: "#cccccc"
                            }
                        }

                        RowLayout {
                            spacing: 5
                            Image {
                                source: "qrc:/res/gpu.svg"
                                width: 16
                                height: 16
                            }
                            Label {
                                text: "RTX 3060 12GB"
                                font.pixelSize: 11
                                color: "#cccccc"
                            }
                        }

                        RowLayout {
                            spacing: 5
                            Image {
                                source: "qrc:/res/ram.svg"
                                width: 16
                                height: 16
                            }
                            Label {
                                text: "32GB RAM"
                                font.pixelSize: 11
                                color: "#cccccc"
                            }
                        }
                    }

                    Item {
                        Layout.fillHeight: true
                    }

                    Label {
                        text: "THUÊ NGAY"
                        Layout.fillWidth: true
                        horizontalAlignment: Text.AlignHCenter
                        color: "#00ff00"
                        font.bold: true
                        font.pixelSize: 14
                        padding: 10
                    }
                }
            }

            // Pro Package
            Rectangle {
                Layout.fillWidth: true
                Layout.fillHeight: true
                color: "#2a3a4a"
                radius: 10

                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: 15
                    spacing: 10

                    Label {
                        text: "CHUYÊN DỤNG"
                        font.pixelSize: 16
                        font.bold: true
                        color: "#ffffff"
                    }

                    Label {
                        text: "10.000₫/h"
                        font.pixelSize: 20
                        font.bold: true
                        color: "#00ccff"
                    }

                    Label {
                        text: "Chơi game siêu mượt."
                        font.pixelSize: 12
                        color: "#cccccc"
                        wrapMode: Text.WordWrap
                    }

                    Rectangle {
                        height: 1
                        Layout.fillWidth: true
                        color: "#555555"
                    }

                    Label {
                        text: "Cấu hình máy"
                        font.pixelSize: 12
                        font.bold: true
                        color: "#ffffff"
                    }

                    ColumnLayout {
                        spacing: 5
                        Layout.fillWidth: true

                        RowLayout {
                            spacing: 5
                            Image {
                                source: "qrc:/res/cpu.svg"
                                width: 16
                                height: 16
                            }
                            Label {
                                text: "Core i5 12400F"
                                font.pixelSize: 11
                                color: "#cccccc"
                            }
                        }

                        RowLayout {
                            spacing: 5
                            Image {
                                source: "qrc:/res/gpu.svg"
                                width: 16
                                height: 16
                            }
                            Label {
                                text: "RTX 3060Ti 8GB"
                                font.pixelSize: 11
                                color: "#cccccc"
                            }
                        }

                        RowLayout {
                            spacing: 5
                            Image {
                                source: "qrc:/res/ram.svg"
                                width: 16
                                height: 16
                            }
                            Label {
                                text: "32GB RAM"
                                font.pixelSize: 11
                                color: "#cccccc"
                            }
                        }
                    }

                    Item {
                        Layout.fillHeight: true
                    }

                    Button {
                        text: "THUÊ NGAY"
                        Layout.fillWidth: true
                        Material.accent: Material.Cyan
                        onClicked: {
                            console.log("Subscribe to Pro package")
                        }
                    }
                }
            }

            // Ultimate Package
            Rectangle {
                Layout.fillWidth: true
                Layout.fillHeight: true
                color: "#3a3a3a"
                radius: 10

                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: 15
                    spacing: 10

                    Label {
                        text: "NÂNG CAO"
                        font.pixelSize: 16
                        font.bold: true
                        color: "#cccccc"
                    }

                    Label {
                        text: "12.000₫/h"
                        font.pixelSize: 20
                        font.bold: true
                        color: "#cccccc"
                    }

                    Label {
                        text: "Cần mọi tính năng game."
                        font.pixelSize: 12
                        color: "#999999"
                        wrapMode: Text.WordWrap
                    }

                    Rectangle {
                        height: 1
                        Layout.fillWidth: true
                        color: "#555555"
                    }

                    Label {
                        text: "Cấu hình máy"
                        font.pixelSize: 12
                        font.bold: true
                        color: "#cccccc"
                    }

                    ColumnLayout {
                        spacing: 5
                        Layout.fillWidth: true

                        RowLayout {
                            spacing: 5
                            Image {
                                source: "qrc:/res/cpu.svg"
                                width: 16
                                height: 16
                            }
                            Label {
                                text: "Core i5 12400F"
                                font.pixelSize: 11
                                color: "#999999"
                            }
                        }

                        RowLayout {
                            spacing: 5
                            Image {
                                source: "qrc:/res/gpu.svg"
                                width: 16
                                height: 16
                            }
                            Label {
                                text: "RTX 4080 16GB"
                                font.pixelSize: 11
                                color: "#999999"
                            }
                        }

                        RowLayout {
                            spacing: 5
                            Image {
                                source: "qrc:/res/ram.svg"
                                width: 16
                                height: 16
                            }
                            Label {
                                text: "32GB RAM"
                                font.pixelSize: 11
                                color: "#999999"
                            }
                        }
                    }

                    Item {
                        Layout.fillHeight: true
                    }

                    Button {
                        text: "THUÊ NGAY"
                        Layout.fillWidth: true
                        enabled: false
                        onClicked: {}
                    }
                }
            }
        }
    }
}
