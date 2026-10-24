// Temporary local data. Later, this will be loaded from Google Sheets.
window.SNACK_DATA = {
  members: [
    { id: "1001", type: "Brother", name: "Augie Bunting", initials: "AB" },
    { id: "2047", type: "Brother", name: "James Carter", initials: "JC" },
    { id: "3189", type: "Brother", name: "Michael Reed", initials: "MR" }
  ],

  // Keep a permanent ID for each pledge even though they do not type it.
  // These example names can later be replaced by active rows from the Pledges sheet.
  pledges: [
    { id: "P0001", type: "Pledge", firstName: "Colin", lastName: "Gold", status: "Active" },
    { id: "P0002", type: "Pledge", firstName: "William", lastName: "Irvin", status: "Active" },
    { id: "P0003", type: "Pledge", firstName: "Dawson", lastName: "Moragne", status: "Active" },
    { id: "P0004", type: "Pledge", firstName: "Joseph", lastName: "Walter", status: "Active" },
    { id: "P0005", type: "Pledge", firstName: "Darin", lastName: "Xie", status: "Active" },
    { id: "P0006", type: "Pledge", firstName: "William", lastName: "Reese", status: "Active" },
    { id: "P0007", type: "Pledge", firstName: "Samuel", lastName: "Maas", status: "Active" },
    { id: "P0008", type: "Pledge", firstName: "Nathanial", lastName: "Hale", status: "Active" }
  ],

  categories: ["Food", "Drinks", "Other"],

  products: [
    { id: "1001", name: "Lay's Classic", price: 1.25, category: "Food", starred: false },
    { id: "1002", name: "Doritos Nacho", price: 1.50, category: "Food", starred: false },
    { id: "1003", name: "Airheads", price: 1.00, category: "Food", starred: false },
    { id: "1004", name: "Pure Protein Bar", price: 2.00, category: "Food", starred: false },
    { id: "1005", name: "Pizza", price: 1.00, category: "Food", starred: true },
    { id: "2001", name: "Coke", price: 1.00, category: "Drinks", starred: false },
    { id: "2002", name: "Powerade Mountain Berry Blast", price: 1.50, category: "Drinks", group: "Powerade", flavor: "Mountain Berry Blast", starred: false },
    { id: "2003", name: "Powerade Fruit Punch", price: 1.50, category: "Drinks", group: "Powerade", flavor: "Fruit Punch", starred: false },
    { id: "2004", name: "Alani Nu Cosmic Stardust", price: 2.50, category: "Drinks", group: "Alani Nu", flavor: "Cosmic Stardust", starred: true },
    { id: "2005", name: "Alani Nu Cherry Slush", price: 2.50, category: "Drinks", group: "Alani Nu", flavor: "Cherry Slush", starred: true },
    { id: "2006", name: "Premier Protein Chocolate", price: 2.50, category: "Drinks", group: "Premier Protein", flavor: "Chocolate", starred: false },
    { id: "2007", name: "Premier Protein Café Latte", price: 2.50, category: "Drinks", group: "Premier Protein", flavor: "Café Latte", starred: false },
    { id: "3001", name: "AA Batteries", price: 1.00, category: "Other", starred: false },
    { id: "3002", name: "AAA Batteries", price: 1.00, category: "Other", starred: false }
  ]
};
